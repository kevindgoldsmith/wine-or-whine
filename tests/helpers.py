"""Shared helpers for engine tests."""
from __future__ import annotations

from engine.boards import board_for, load_boards
from engine.game import DECK_BREEZY, DECK_OVER, GameState, apply, new_game

BOARDS = load_boards()


def deck_with(top: str) -> list[str]:
    """A legal 17-card deck whose top cards are ``top`` (e.g. "OOB")."""
    b, o = DECK_BREEZY - top.count("B"), DECK_OVER - top.count("O")
    assert b >= 0 and o >= 0
    return list(top) + ["B"] * b + ["O"] * o


def make(n: int, pres: int = 0, roles: list[str] | None = None, deck: str = "", board=None, ack: bool = True) -> GameState:
    s, _ = new_game(n, seed=1234, board=board if board is not None else board_for(n, BOARDS), first_president=pres)
    if roles is not None:
        assert len(roles) == n
        s.roles = list(roles)
    if deck:
        s.deck = deck_with(deck)
    if ack:
        for p in range(n):
            s, _ = apply(s, p, {"type": "ack_role"})
    return s


def roles_with_chief(n: int, chief: int, overs: tuple[int, ...] = ()) -> list[str]:
    from engine.game import SETUP

    need = SETUP[n][1]
    overs = tuple(overs)
    rest = [p for p in range(n) if p != chief and p not in overs]
    while len(overs) < need:
        overs = overs + (rest.pop(),)
    r = ["chill"] * n
    r[chief] = "chief"
    for p in overs:
        r[p] = "over"
    return r


def act(s: GameState, seat: int, **action):
    return apply(s, seat, action)


def vote(s: GameState, yes_seats=None, all_yes: bool | None = None):
    events = []
    for p in s.living():
        y = all_yes if all_yes is not None else (p in yes_seats)
        s, ev = apply(s, p, {"type": "vote", "yes": y})
        events += ev
    return s, events


def govern(s: GameState, chanc: int, discard: int = 0, enact: int = 0):
    """Nominate ``chanc``, all vote yes, discard index ``discard``, enact index ``enact``."""
    events = []
    s, ev = act(s, s.president, type="nominate", target=chanc)
    events += ev
    s, ev = vote(s, all_yes=True)
    events += ev
    if s.phase != "pres_discard":
        return s, events
    s, ev = act(s, s.president, type="discard", index=discard)
    events += ev
    s, ev = act(s, s.chancellor, type="enact", index=enact)
    events += ev
    return s, events


def fail_vote(s: GameState, chanc: int | None = None):
    if chanc is None:
        from engine.game import eligible_nominees

        chanc = eligible_nominees(s)[0]
    s, _ = act(s, s.president, type="nominate", target=chanc)
    return vote(s, all_yes=False)


def card_total(s: GameState) -> int:
    return len(s.deck) + len(s.discard) + s.breezy + s.over + len(s.hand)


def set_board(s: GameState, breezy: int | None = None, over: int | None = None) -> GameState:
    """Put cards on the board, taking them out of the deck bottom so 17 cards stay accounted for."""
    for kind, count in (("B", breezy), ("O", over)):
        if count is None:
            continue
        cur = s.breezy if kind == "B" else s.over
        for _ in range(count - cur):
            idx = len(s.deck) - 1 - s.deck[::-1].index(kind)
            s.deck.pop(idx)
        if kind == "B":
            s.breezy = count
        else:
            s.over = count
    return s
