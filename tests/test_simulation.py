"""Seeded random-play simulations with invariant and information-leak checks (brief §9).

Scale with SIM_GAMES (games per player count, default 1000) and SIM_LEAK_GAMES (games per player
count that also run the full leak checks on every step, default 100).
"""
from __future__ import annotations

import json
import os
import random

import pytest

from engine.boards import board_for
from engine.game import GameState, apply, eligible_nominees, legal_actions, new_game, waiting_on
from engine.views import known_roles, player_view, spectator_view, tv_view
from helpers import BOARDS

SIM_GAMES = int(os.environ.get("SIM_GAMES", "1000"))
SIM_LEAK_GAMES = int(os.environ.get("SIM_LEAK_GAMES", "100"))
PHASES = {"reveal", "nominate", "vote", "pres_discard", "chanc_enact", "veto_response", "power", "power_result", "game_over"}
SECRET_KEYS = {"deck", "discard", "roles_secret", "rng", "hand_all", "votes", "private", "pending"}


def check_invariants(s: GameState) -> None:
    assert s.phase in PHASES
    cards = s.deck + s.discard + s.hand
    assert len(cards) + s.breezy + s.over == 17, "cards lost or duplicated"
    assert cards.count("B") + s.breezy == 6
    assert cards.count("O") + s.over == 11
    assert 0 <= s.breezy <= 5 and 0 <= s.over <= 6
    assert 0 <= s.meter <= 2
    assert sum(s.alive) >= s.n - 2 >= 3
    assert s.roles.count("chief") == 1
    if s.phase == "game_over":
        assert s.winner in ("chill", "over")
        return
    assert s.alive[s.president]
    if s.chancellor is not None:
        assert s.alive[s.chancellor] and s.chancellor != s.president
    if s.phase == "nominate":
        assert eligible_nominees(s), "president has nobody to nominate"
        assert len(s.deck) >= 3
    if s.phase == "pres_discard":
        assert len(s.hand) == 3
    if s.phase in ("chanc_enact", "veto_response"):
        assert len(s.hand) == 2
    if s.phase == "veto_response":
        assert s.over >= 5
    assert waiting_on(s), "game is stuck"
    for p in waiting_on(s):
        assert legal_actions(s, p), "waiting on a player with no legal move"


# ---------------------------------------------------------------- leak checks

def _perturb_for(s: GameState, viewer: int | None, r: random.Random) -> GameState:
    """Change every secret ``viewer`` must not know (viewer None = the TV). Public facts stay fixed."""
    t = s.clone()
    r.shuffle(t.deck)
    if t.deck and t.discard:  # swap a card between deck and discard: composition is secret too
        i, j = r.randrange(len(t.deck)), r.randrange(len(t.discard))
        t.deck[i], t.discard[j] = t.discard[j], t.deck[i]
    r.shuffle(t.discard)
    t.rng = r.getrandbits(64)
    known = set(known_roles(s, viewer)) if viewer is not None else set()
    unknown = [p for p in range(t.n) if p not in known]
    roles = [t.roles[p] for p in unknown]
    r.shuffle(roles)
    for p, role in zip(unknown, roles):
        t.roles[p] = role
    for p in range(t.n):
        if p != viewer and t.votes[p] is not None:
            t.votes[p] = not t.votes[p]
    holder = None
    if s.phase == "pres_discard":
        holder = s.president
    elif s.phase in ("chanc_enact", "veto_response"):
        holder = s.chancellor
    if t.hand and holder != viewer:
        t.hand = [r.choice("BO") for _ in t.hand]
    for p in range(t.n):
        if p != viewer:
            t.private[p] = [{"type": "peek", "day": 0, "cards": [r.choice("BO")] * 3}] * r.randrange(3)
    if t.pending_result is not None and viewer != s.president:
        t.pending_result = {"type": "investigate", "day": 0, "target": 0, "team": r.choice(["chill", "over"])}
    return t


def check_no_leaks(s: GameState, r: random.Random) -> None:
    if s.phase == "game_over":
        return  # everything is revealed at game over
    tv = tv_view(s)
    blob = json.dumps(tv)
    assert tv["roles"] is None and "hand" not in tv and "known" not in tv and "role" not in tv
    assert '"cards"' not in blob and '"team"' not in blob
    t = _perturb_for(s, None, r)
    assert tv_view(t) == tv, "TV view depends on a secret"
    for p in range(s.n):
        if not s.alive[p]:
            v = spectator_view(s, p)
            pt = _perturb_for(s, p, r)
            pt.roles[p] = s.roles[p]
            # A spectator may only know their own role beyond the TV view.
            assert {k: x for k, x in v.items() if k not in ("me", "role", "spectator")} == tv
            continue
        v = player_view(s, p)
        assert set(v["known"]) == {str(k) for k in known_roles(s, p)}
        if v["hand"] is not None:
            assert (s.phase == "pres_discard" and p == s.president) or (
                s.phase in ("chanc_enact", "veto_response") and p == s.chancellor
            )
        if v["pending_result"] is not None:
            assert p == s.president
        if s.phase == "vote":
            assert v["my_vote"] == s.votes[p]
        pt = _perturb_for(s, p, r)
        assert player_view(pt, p) == v, f"player {p} view depends on a secret in phase {s.phase}"


# ---------------------------------------------------------------- driver

def play_random_game(n: int, seed: int, leak_checks: bool = False, board=None) -> GameState:
    r = random.Random(seed)
    s, _ = new_game(n, seed, board or board_for(n, BOARDS))
    check_invariants(s)
    for _step in range(3000):
        if s.phase == "game_over":
            return s
        seat = r.choice(waiting_on(s))
        action = r.choice(legal_actions(s, seat))
        s, events = apply(s, seat, action)
        check_invariants(s)
        json.dumps(events)
        for e in events:
            assert "deck" not in e or isinstance(e["deck"], int)
            if e["type"] != "game_over":
                assert "roles" not in e and "hand" not in e and "cards" not in e
        if leak_checks:
            check_no_leaks(s, r)
    raise AssertionError("game did not end")


@pytest.mark.parametrize("n", range(5, 11))
def test_random_games_end_with_invariants(n):
    winners = {"chill": 0, "over": 0}
    reasons = set()
    for seed in range(SIM_GAMES):
        s = play_random_game(n, seed * 1000 + n)
        winners[s.winner] += 1
        reasons.add(s.win_reason)
    assert winners["chill"] and winners["over"]
    if SIM_GAMES >= 200:
        assert reasons == {"breezy5", "over6", "chief_out", "chief_elected"}


@pytest.mark.parametrize("n", range(5, 11))
def test_random_games_never_leak(n):
    for seed in range(SIM_LEAK_GAMES):
        play_random_game(n, 7_000_000 + seed * 100 + n, leak_checks=True)


def test_random_games_with_house_rules():
    r = random.Random(5)
    powers = [None, "investigate", "special_election", "peek", "execute"]
    for seed in range(max(50, SIM_GAMES // 10)):
        board = [r.choice(powers) for _ in range(5)]
        while board.count("execute") > 2:
            board[board.index("execute")] = None
        n = r.randint(5, 10)
        play_random_game(n, seed, leak_checks=seed % 5 == 0, board=board)
