"""Pure rules engine for Secret-Hitler-style play (themed elsewhere).

No I/O: ``new_game`` and ``apply`` take state (and an action) and return a new state plus a list of
*public* events. Secret information only ever lives in the state object; views decide who sees what.

Vocabulary (engine words, never shown to players):
  roles: ``chill`` (liberal), ``over`` (fascist), ``chief`` (Hitler)
  cards: ``B`` (breezy / liberal), ``O`` (overscheduled / fascist)
  president = First One Awake, chancellor = Day Planner, meter = election tracker
  powers: ``investigate``, ``special_election``, ``peek``, ``execute``
"""
from __future__ import annotations

import copy
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from .rng import Rng

BREEZY_TO_WIN = 5
OVER_TO_WIN = 6
VETO_AT = 5
CHIEF_DANGER_AT = 3
METER_MAX = 3
DECK_BREEZY = 6
DECK_OVER = 11
DECK_SIZE = DECK_BREEZY + DECK_OVER
MAX_EXECUTIONS = 2
POWERS = ("investigate", "special_election", "peek", "execute")

# players -> (chill parents, overschedulers excluding the chief)
SETUP = {5: (3, 1), 6: (4, 1), 7: (4, 2), 8: (5, 2), 9: (5, 3), 10: (6, 3)}


class IllegalAction(Exception):
    """Raised for any action that is not legal right now. ``reason`` is safe to log (no secrets)."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass
class GameState:
    n: int
    roles: list[str]
    alive: list[bool]
    deck: list[str]  # index 0 is the top card
    discard: list[str]
    board: list[Optional[str]]  # power for the 1st..5th overscheduled card
    rng: int
    phase: str = "reveal"
    day: int = 0
    breezy: int = 0
    over: int = 0
    meter: int = 0
    president: int = 0
    nominee: Optional[int] = None
    chancellor: Optional[int] = None
    last_pres: Optional[int] = None
    last_chanc: Optional[int] = None
    special_next: Optional[int] = None
    special_return: Optional[int] = None
    votes: list[Optional[bool]] = field(default_factory=list)
    hand: list[str] = field(default_factory=list)
    veto_refused: bool = False
    power: Optional[str] = None
    pending_result: Optional[dict] = None
    private: list[list[dict]] = field(default_factory=list)
    investigated: list[int] = field(default_factory=list)
    acks: list[int] = field(default_factory=list)
    winner: Optional[str] = None
    win_reason: Optional[str] = None
    last_vote: Optional[dict] = None
    history: list[dict] = field(default_factory=list)
    superlatives: list[dict] = field(default_factory=list)
    seq: int = 0

    def clone(self) -> "GameState":
        """Fast copy for ``apply``. Events/results are never mutated once created, so their dicts
        can be shared; every mutable container is copied."""
        c = copy.copy(self)
        for name in ("roles", "alive", "deck", "discard", "board", "votes", "hand", "investigated", "acks",
                     "history", "superlatives"):
            setattr(c, name, list(getattr(self, name)))
        c.private = [list(x) for x in self.private]
        return c

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "GameState":
        return cls(**copy.deepcopy(d))

    # --- small helpers ---
    def living(self) -> list[int]:
        return [p for p in range(self.n) if self.alive[p]]

    def team(self, seat: int) -> str:
        return "chill" if self.roles[seat] == "chill" else "over"


# Events that are emitted (for live animations) but are too noisy for the history log.
_NOT_IN_HISTORY = {"vote_cast", "role_ack"}


class _Emitter:
    def __init__(self, s: GameState):
        self.s = s
        self.events: list[dict] = []

    def __call__(self, type_: str, **data: Any) -> None:
        self.s.seq += 1
        e = {"type": type_, "seq": self.s.seq, "day": self.s.day, **data}
        self.events.append(e)
        if type_ not in _NOT_IN_HISTORY:
            self.s.history.append(e)


def validate_board(board: list) -> list[Optional[str]]:
    if not isinstance(board, list) or len(board) != 5:
        raise ValueError("board must list exactly 5 slots")
    out = []
    for slot in board:
        if slot is not None and slot not in POWERS:
            raise ValueError(f"unknown power {slot!r}")
        out.append(slot)
    if out.count("execute") > MAX_EXECUTIONS:
        raise ValueError(f"at most {MAX_EXECUTIONS} babysitter-duty slots (the game needs 3+ players left)")
    return out


def new_game(n: int, seed: int, board: list, first_president: Optional[int] = None) -> tuple[GameState, list[dict]]:
    """Deal a new game. ``board`` is the list of 5 power slots for this player count."""
    if n not in SETUP:
        raise IllegalAction("need 5 to 10 players")
    rng = Rng(seed)
    chill, over = SETUP[n]
    roles = ["chill"] * chill + ["over"] * over + ["chief"]
    rng.shuffle(roles)
    deck = ["B"] * DECK_BREEZY + ["O"] * DECK_OVER
    rng.shuffle(deck)
    pres = rng.below(n) if first_president is None else first_president
    s = GameState(
        n=n,
        roles=roles,
        alive=[True] * n,
        deck=deck,
        discard=[],
        board=validate_board(list(board)),
        rng=rng.state,
        president=pres,
        votes=[None] * n,
        private=[[] for _ in range(n)],
    )
    ev = _Emitter(s)
    ev("game_start", n=n)
    return s, ev.events


# ---------------------------------------------------------------- queries

def living_count(s: GameState) -> int:
    return sum(1 for a in s.alive if a)


def term_limited(s: GameState) -> list[int]:
    """Players who are 'sleeping in' and cannot be nominated today."""
    out = []
    if s.last_chanc is not None and s.alive[s.last_chanc]:
        out.append(s.last_chanc)
    if living_count(s) > 5 and s.last_pres is not None and s.alive[s.last_pres] and s.last_pres not in out:
        out.append(s.last_pres)
    return out


def eligible_nominees(s: GameState) -> list[int]:
    limited = set(term_limited(s))
    return [p for p in s.living() if p != s.president and p not in limited]


def veto_unlocked(s: GameState) -> bool:
    return s.over >= VETO_AT


def power_targets(s: GameState) -> list[int]:
    if s.phase != "power":
        return []
    others = [p for p in s.living() if p != s.president]
    if s.power == "investigate":
        return [p for p in others if p not in s.investigated]
    return others


def waiting_on(s: GameState) -> list[int]:
    ph = s.phase
    if ph == "reveal":
        return [p for p in s.living() if p not in s.acks]
    if ph == "vote":
        return [p for p in s.living() if s.votes[p] is None]
    if ph in ("nominate", "pres_discard", "veto_response", "power", "power_result"):
        return [s.president]
    if ph == "chanc_enact":
        return [s.chancellor]  # type: ignore[list-item]
    return []


def legal_actions(s: GameState, seat: int) -> list[dict]:
    """Every legal action for ``seat`` (used by simulations and to validate UI)."""
    if s.phase == "game_over" or not s.alive[seat] or seat not in waiting_on(s):
        return []
    ph = s.phase
    if ph == "reveal":
        return [{"type": "ack_role"}]
    if ph == "nominate":
        return [{"type": "nominate", "target": t} for t in eligible_nominees(s)]
    if ph == "vote":
        return [{"type": "vote", "yes": True}, {"type": "vote", "yes": False}]
    if ph == "pres_discard":
        return [{"type": "discard", "index": i} for i in range(len(s.hand))]
    if ph == "chanc_enact":
        acts = [{"type": "enact", "index": i} for i in range(len(s.hand))]
        if veto_unlocked(s) and not s.veto_refused:
            acts.append({"type": "propose_veto"})
        return acts
    if ph == "veto_response":
        return [{"type": "veto", "accept": True}, {"type": "veto", "accept": False}]
    if ph == "power":
        return [{"type": "power_target", "target": t} for t in power_targets(s)]
    if ph == "power_result":
        return [{"type": "power_ack"}]
    return []


# ---------------------------------------------------------------- transitions

def apply(state: GameState, seat: int, action: dict) -> tuple[GameState, list[dict]]:
    """Apply ``action`` by ``seat``. Returns (new_state, public_events). Raises IllegalAction."""
    if not isinstance(action, dict):
        raise IllegalAction("malformed action")
    handler = _HANDLERS.get(action.get("type"))  # type: ignore[arg-type]
    if handler is None:
        raise IllegalAction("unknown action")
    if state.phase == "game_over":
        raise IllegalAction("game is over")
    if not isinstance(seat, int) or not (0 <= seat < state.n):
        raise IllegalAction("bad seat")
    if not state.alive[seat]:
        raise IllegalAction("player is out")
    s = state.clone()
    ev = _Emitter(s)
    handler(s, seat, action, ev)
    return s, ev.events


def _need(cond: bool, reason: str) -> None:
    if not cond:
        raise IllegalAction(reason)


def _int_field(action: dict, key: str) -> int:
    v = action.get(key)
    _need(isinstance(v, int) and not isinstance(v, bool), f"missing {key}")
    return v  # type: ignore[return-value]


def _bool_field(action: dict, key: str) -> bool:
    v = action.get(key)
    _need(isinstance(v, bool), f"missing {key}")
    return v  # type: ignore[return-value]


def _ack_role(s: GameState, seat: int, a: dict, ev: _Emitter) -> None:
    _need(s.phase == "reveal", "wrong phase")
    _need(seat not in s.acks, "already acknowledged")
    s.acks.append(seat)
    ev("role_ack", seat=seat)
    if all(p in s.acks for p in s.living()):
        s.day = 1
        s.phase = "nominate"
        ev("day_start", president=s.president)


def _nominate(s: GameState, seat: int, a: dict, ev: _Emitter) -> None:
    _need(s.phase == "nominate", "wrong phase")
    _need(seat == s.president, "not the president")
    target = _int_field(a, "target")
    _need(target in eligible_nominees(s), "ineligible nominee")
    s.nominee = target
    s.votes = [None] * s.n
    s.phase = "vote"
    ev("nominated", president=s.president, nominee=target)


def _vote(s: GameState, seat: int, a: dict, ev: _Emitter) -> None:
    _need(s.phase == "vote", "wrong phase")
    yes = _bool_field(a, "yes")
    _need(s.votes[seat] is None, "already voted")
    s.votes[seat] = yes
    ev("vote_cast", seat=seat)
    if any(s.votes[p] is None for p in s.living()):
        return
    living = living_count(s)
    n_yes = sum(1 for p in s.living() if s.votes[p])
    passed = n_yes * 2 > living
    s.last_vote = {
        "day": s.day,
        "president": s.president,
        "nominee": s.nominee,
        "votes": list(s.votes),
        "yes": n_yes,
        "no": living - n_yes,
        "passed": passed,
    }
    ev("vote_result", **{k: v for k, v in s.last_vote.items() if k != "day"})
    s.votes = [None] * s.n
    if not passed:
        s.nominee = None
        _meter_tick(s, ev)
        if s.phase != "game_over":
            _end_day(s, ev)
        return
    nominee = s.nominee
    assert nominee is not None
    if s.over >= CHIEF_DANGER_AT and s.roles[nominee] == "chief":
        s.chancellor = nominee
        _game_over(s, ev, "over", "chief_elected")
        return
    s.chancellor = nominee
    s.nominee = None
    s.last_pres, s.last_chanc = s.president, nominee
    _reshuffle_if(s, ev, 3)
    s.hand, s.deck = s.deck[:3], s.deck[3:]
    s.veto_refused = False
    s.phase = "pres_discard"
    ev("government", president=s.president, chancellor=nominee)


def _discard(s: GameState, seat: int, a: dict, ev: _Emitter) -> None:
    _need(s.phase == "pres_discard", "wrong phase")
    _need(seat == s.president, "not the president")
    i = _int_field(a, "index")
    _need(0 <= i < len(s.hand), "bad card")
    s.discard.append(s.hand.pop(i))
    s.phase = "chanc_enact"
    ev("president_passed", president=s.president, chancellor=s.chancellor)


def _enact(s: GameState, seat: int, a: dict, ev: _Emitter) -> None:
    _need(s.phase == "chanc_enact", "wrong phase")
    _need(seat == s.chancellor, "not the chancellor")
    i = _int_field(a, "index")
    _need(0 <= i < len(s.hand), "bad card")
    card = s.hand.pop(i)
    s.discard.extend(s.hand)
    s.hand = []
    _place_card(s, ev, card, forced=False)
    if s.phase == "game_over":
        return
    power = s.board[s.over - 1] if card == "O" and 1 <= s.over <= 5 else None
    if power:
        _start_power(s, ev, power)
    else:
        _end_day(s, ev)


def _propose_veto(s: GameState, seat: int, a: dict, ev: _Emitter) -> None:
    _need(s.phase == "chanc_enact", "wrong phase")
    _need(seat == s.chancellor, "not the chancellor")
    _need(veto_unlocked(s), "veto locked")
    _need(not s.veto_refused, "veto already refused today")
    s.phase = "veto_response"
    ev("veto_proposed", president=s.president, chancellor=s.chancellor)


def _veto(s: GameState, seat: int, a: dict, ev: _Emitter) -> None:
    _need(s.phase == "veto_response", "wrong phase")
    _need(seat == s.president, "not the president")
    accept = _bool_field(a, "accept")
    ev("veto_result", accepted=accept, president=s.president, chancellor=s.chancellor)
    if not accept:
        s.veto_refused = True
        s.phase = "chanc_enact"
        return
    s.discard.extend(s.hand)
    s.hand = []
    _meter_tick(s, ev)
    if s.phase != "game_over":
        _end_day(s, ev)


def _power_target(s: GameState, seat: int, a: dict, ev: _Emitter) -> None:
    _need(s.phase == "power", "wrong phase")
    _need(seat == s.president, "not the president")
    target = _int_field(a, "target")
    _need(target in power_targets(s), "ineligible target")
    power = s.power
    ev("power_used", power=power, president=seat, target=target)
    if power == "investigate":
        s.investigated.append(target)
        result = {"type": "investigate", "day": s.day, "target": target, "team": s.team(target)}
        s.pending_result = result
        s.private[seat].append(result)
        s.phase = "power_result"
    elif power == "special_election":
        s.special_next = target
        s.special_return = seat
        _end_day(s, ev)
    elif power == "execute":
        s.alive[target] = False
        ev("executed", target=target)
        if s.roles[target] == "chief":
            _game_over(s, ev, "chill", "chief_out")
        else:
            _end_day(s, ev)


def _power_ack(s: GameState, seat: int, a: dict, ev: _Emitter) -> None:
    _need(s.phase == "power_result", "wrong phase")
    _need(seat == s.president, "not the president")
    s.pending_result = None
    _end_day(s, ev)


_HANDLERS = {
    "ack_role": _ack_role,
    "nominate": _nominate,
    "vote": _vote,
    "discard": _discard,
    "enact": _enact,
    "propose_veto": _propose_veto,
    "veto": _veto,
    "power_target": _power_target,
    "power_ack": _power_ack,
}


# ---------------------------------------------------------------- internals

def _reshuffle_if(s: GameState, ev: _Emitter, need: int) -> None:
    if len(s.deck) >= need:
        return
    rng = Rng(s.rng)
    s.deck = s.deck + s.discard
    s.discard = []
    rng.shuffle(s.deck)
    s.rng = rng.state
    ev("reshuffle", deck=len(s.deck))


def _meter_tick(s: GameState, ev: _Emitter) -> None:
    s.meter += 1
    ev("meter", value=s.meter)
    if s.meter >= METER_MAX:
        _reshuffle_if(s, ev, 1)
        card = s.deck.pop(0)
        ev("forced", card=card)
        _place_card(s, ev, card, forced=True)
        if s.phase == "game_over":
            return
        s.last_pres = s.last_chanc = None
        ev("term_reset")


def _place_card(s: GameState, ev: _Emitter, card: str, forced: bool) -> None:
    if card == "B":
        s.breezy += 1
        count = s.breezy
    else:
        s.over += 1
        count = s.over
    s.meter = 0
    ev(
        "enacted",
        card=card,
        count=count,
        forced=forced,
        president=None if forced else s.president,
        chancellor=None if forced else s.chancellor,
    )
    if s.breezy >= BREEZY_TO_WIN:
        _game_over(s, ev, "chill", "breezy5")
    elif s.over >= OVER_TO_WIN:
        _game_over(s, ev, "over", "over6")


def _start_power(s: GameState, ev: _Emitter, power: str) -> None:
    s.power = power
    ev("power", power=power, president=s.president)
    if power == "peek":
        _reshuffle_if(s, ev, 3)
        result = {"type": "peek", "day": s.day, "cards": s.deck[:3]}
        s.pending_result = result
        s.private[s.president].append(result)
        s.phase = "power_result"
    else:
        s.phase = "power"


def _next_alive_after(s: GameState, seat: int) -> int:
    for k in range(1, s.n + 1):
        p = (seat + k) % s.n
        if s.alive[p]:
            return p
    raise AssertionError("nobody alive")


def _end_day(s: GameState, ev: _Emitter) -> None:
    _reshuffle_if(s, ev, 3)
    s.nominee = None
    s.chancellor = None
    s.hand = []
    s.votes = [None] * s.n
    s.veto_refused = False
    s.power = None
    s.pending_result = None
    if s.special_next is not None:
        s.president = s.special_next
        s.special_next = None
    elif s.special_return is not None:
        s.president = _next_alive_after(s, s.special_return)
        s.special_return = None
    else:
        s.president = _next_alive_after(s, s.president)
    s.day += 1
    s.phase = "nominate"
    ev("day_start", president=s.president)


def _game_over(s: GameState, ev: _Emitter, winner: str, reason: str) -> None:
    s.phase = "game_over"
    s.winner = winner
    s.win_reason = reason
    s.pending_result = None
    s.superlatives = superlatives(s)
    ev("game_over", winner=winner, reason=reason, roles=list(s.roles), superlatives=s.superlatives)


# ---------------------------------------------------------------- superlatives

def superlatives(s: GameState) -> list[dict]:
    """Fun awards computed from the public history plus the (now revealed) roles."""
    n = s.n
    over_gov = [0] * n
    breezy_gov = [0] * n
    yes_when_nominated = [0] * n
    no_votes = [0] * n
    for e in s.history:
        if e["type"] == "enacted" and not e["forced"]:
            for p in (e["president"], e["chancellor"]):
                if p is None:
                    continue
                if e["card"] == "O":
                    over_gov[p] += 1
                else:
                    breezy_gov[p] += 1
        elif e["type"] == "vote_result":
            yes_when_nominated[e["nominee"]] += e["yes"]
            for p, v in enumerate(e["votes"]):
                if v is False:
                    no_votes[p] += 1

    def best(key: str, scores: list[int], eligible) -> Optional[dict]:
        pool = [p for p in range(n) if eligible(p) and scores[p] > 0]
        if not pool:
            return None
        top = max(scores[p] for p in pool)
        seats = [p for p in pool if scores[p] == top]
        if len(seats) > 3:  # a 4+-way tie isn't an award (and doesn't fit on a TV card)
            return None
        return {"key": key, "seats": seats, "count": top}

    awards = [
        best("one_more_stop", over_gov, lambda p: True),
        best("poker_face", yes_when_nominated, lambda p: s.roles[p] != "chill"),
        best("nap_champion", breezy_gov, lambda p: s.roles[p] == "chill"),
        best("never_trusted", no_votes, lambda p: True),
    ]
    return [a for a in awards if a]
