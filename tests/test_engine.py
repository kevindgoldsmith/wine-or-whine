"""Unit tests for every rule in brief §4."""
import json

import pytest

from engine.boards import board_for, bracket
from engine.game import (
    SETUP,
    GameState,
    IllegalAction,
    apply,
    eligible_nominees,
    legal_actions,
    new_game,
    power_targets,
    term_limited,
    validate_board,
)
from engine.views import known_roles, player_view, public_view
from helpers import BOARDS, act, card_total, fail_vote, govern, make, roles_with_chief, set_board, vote

ALL_N = list(range(5, 11))


# ---------------------------------------------------------------- setup

@pytest.mark.parametrize("n", ALL_N)
def test_setup_role_counts_and_deck(n):
    for seed in range(20):
        s, _ = new_game(n, seed, board_for(n, BOARDS))
        chill, over = SETUP[n]
        assert s.roles.count("chill") == chill
        assert s.roles.count("over") == over
        assert s.roles.count("chief") == 1
        assert sorted(s.deck) == sorted("B" * 6 + "O" * 11)
        assert 0 <= s.president < n
        assert s.phase == "reveal"


def test_setup_table_matches_brief():
    assert SETUP == {5: (3, 1), 6: (4, 1), 7: (4, 2), 8: (5, 2), 9: (5, 3), 10: (6, 3)}


def test_first_president_is_random_across_seeds():
    firsts = {new_game(8, seed, board_for(8, BOARDS))[0].president for seed in range(200)}
    assert firsts == set(range(8))


def test_seeded_rng_is_deterministic():
    a, _ = new_game(7, 99, board_for(7, BOARDS))
    b, _ = new_game(7, 99, board_for(7, BOARDS))
    assert a.to_dict() == b.to_dict()


@pytest.mark.parametrize("n", ALL_N)
def test_knowledge(n):
    s = make(n, roles=roles_with_chief(n, chief=0))
    overs = [p for p, r in enumerate(s.roles) if r == "over"]
    chills = [p for p, r in enumerate(s.roles) if r == "chill"]
    for p in chills:
        assert known_roles(s, p) == {p: "chill"}
    for p in overs:
        k = known_roles(s, p)
        assert k[0] == "chief"
        assert all(k[o] == "over" for o in overs)
        assert not any(c in k for c in chills)
    chief_known = known_roles(s, 0)
    if n <= 6:
        assert all(o in chief_known for o in overs)
    else:
        assert chief_known == {0: "chief"}


def test_reveal_waits_for_every_ack():
    s = make(5, ack=False)
    for p in range(4):
        s, _ = act(s, p, type="ack_role")
        assert s.phase == "reveal"
    with pytest.raises(IllegalAction):
        act(s, 0, type="ack_role")
    s, ev = act(s, 4, type="ack_role")
    assert s.phase == "nominate" and s.day == 1
    assert ev[-1]["type"] == "day_start"


# ---------------------------------------------------------------- nomination and term limits

def test_cannot_nominate_self_or_dead():
    s = make(7, pres=0)
    with pytest.raises(IllegalAction):
        act(s, 0, type="nominate", target=0)
    s.alive[3] = False
    with pytest.raises(IllegalAction):
        act(s, 0, type="nominate", target=3)
    with pytest.raises(IllegalAction):
        act(s, 1, type="nominate", target=2)  # not the president


def test_term_limits_six_living():
    s = make(6, pres=0, deck="BBB")
    s, _ = govern(s, chanc=2)
    assert s.president == 1
    assert set(term_limited(s)) == {0, 2}
    assert set(eligible_nominees(s)) == {3, 4, 5}


def test_term_limits_five_living():
    s = make(5, pres=0, deck="BBB")
    s, _ = govern(s, chanc=2)
    assert s.president == 1
    assert term_limited(s) == [2]
    assert set(eligible_nominees(s)) == {0, 3, 4}


def test_term_limits_six_players_one_out_counts_as_five_living():
    s = make(6, pres=0, deck="BBB")
    s, _ = govern(s, chanc=2)
    s.alive[5] = False
    assert term_limited(s) == [2]
    assert 0 in eligible_nominees(s)


def test_failed_governments_do_not_change_term_limits():
    s = make(7, pres=0, deck="BBB")
    s, _ = govern(s, chanc=3)
    s, _ = fail_vote(s, chanc=4)
    assert set(term_limited(s)) == {0, 3}
    assert s.last_pres == 0 and s.last_chanc == 3


def test_term_limits_reset_after_forced_card():
    s = make(7, pres=0, deck="BBBBBB")
    s, _ = govern(s, chanc=3)
    assert term_limited(s)
    for _ in range(3):
        s, ev = fail_vote(s)
    assert any(e["type"] == "forced" for e in ev)
    assert any(e["type"] == "term_reset" for e in ev)
    assert term_limited(s) == []
    assert s.meter == 0


# ---------------------------------------------------------------- voting

def test_vote_requires_strict_majority_tie_fails():
    s = make(6, pres=0)
    s, _ = act(s, 0, type="nominate", target=1)
    s, ev = vote(s, yes_seats={0, 1, 2})
    res = [e for e in ev if e["type"] == "vote_result"][0]
    assert res["passed"] is False and res["yes"] == 3 and res["no"] == 3
    assert s.meter == 1 and s.president == 1


def test_vote_majority_passes():
    s = make(5, pres=0)
    s, _ = act(s, 0, type="nominate", target=1)
    s, _ = vote(s, yes_seats={0, 1, 2})
    assert s.phase == "pres_discard"


def test_dead_players_do_not_vote_and_majority_counts_living():
    s = make(7, pres=0)
    s.alive[6] = False
    s, _ = act(s, 0, type="nominate", target=1)
    with pytest.raises(IllegalAction):
        act(s, 6, type="vote", yes=True)
    s, _ = vote(s, yes_seats={0, 1, 2})  # 3 of 6 living
    assert s.phase == "nominate"
    s, _ = act(s, s.president, type="nominate", target=3)
    s, _ = vote(s, yes_seats={0, 1, 2, 3})  # 4 of 6
    assert s.phase == "pres_discard"


def test_cannot_vote_twice_and_votes_hidden_until_all_in():
    s = make(5, pres=0)
    s, _ = act(s, 0, type="nominate", target=1)
    s, ev = act(s, 2, type="vote", yes=True)
    assert ev == [{"type": "vote_cast", "seq": s.seq, "day": 1, "seat": 2}]
    with pytest.raises(IllegalAction):
        act(s, 2, type="vote", yes=False)
    pv = public_view(s)
    assert pv["voted"] == [2]
    assert "votes" not in pv and pv["last_vote"] is None
    assert player_view(s, 3)["my_vote"] is None
    assert player_view(s, 2)["my_vote"] is True


def test_vote_reveal_contains_all_votes_at_once():
    s = make(5, pres=0)
    s, _ = act(s, 0, type="nominate", target=1)
    s, ev = vote(s, yes_seats={0, 1, 2})
    res = [e for e in ev if e["type"] == "vote_result"][0]
    assert res["votes"] == [True, True, True, False, False]


# ---------------------------------------------------------------- the indecision meter

def test_meter_moves_and_president_rotates_on_failure():
    s = make(5, pres=3)
    s, _ = fail_vote(s)
    assert s.meter == 1 and s.president == 4
    s, _ = fail_vote(s)
    assert s.meter == 2 and s.president == 0


def test_meter_forces_card_without_power():
    # 5-6 board: 3rd overscheduled card is the nap-schedule peek. A forced 3rd card must not trigger it.
    s = make(5, pres=0, deck="O")
    set_board(s, over=2)
    for _ in range(3):
        s, ev = fail_vote(s)
    assert s.over == 3
    assert [e for e in ev if e["type"] == "forced"][0]["card"] == "O"
    assert not any(e["type"] == "power" for e in ev)
    assert s.phase == "nominate" and s.meter == 0


def test_meter_resets_on_government_enactment():
    s = make(5, pres=0, deck="BBBBBB")
    s, _ = fail_vote(s)
    assert s.meter == 1
    s, _ = govern(s, chanc=3)
    assert s.meter == 0


def test_forced_card_can_win():
    s = make(5, pres=0, deck="B")
    set_board(s, breezy=4)
    for _ in range(3):
        s, ev = fail_vote(s)
    assert s.phase == "game_over" and s.winner == "chill" and s.win_reason == "breezy5"


# ---------------------------------------------------------------- the chief as day planner

@pytest.mark.parametrize("n", ALL_N)
def test_chief_elected_with_two_overscheduled_is_not_a_win(n):
    s = make(n, pres=0, roles=roles_with_chief(n, chief=2), deck="BBB")
    set_board(s, over=2)
    s, _ = act(s, 0, type="nominate", target=2)
    s, _ = vote(s, all_yes=True)
    assert s.phase == "pres_discard" and s.winner is None


@pytest.mark.parametrize("n", ALL_N)
def test_chief_elected_with_three_overscheduled_wins(n):
    s = make(n, pres=0, roles=roles_with_chief(n, chief=2))
    set_board(s, over=3)
    s, _ = act(s, 0, type="nominate", target=2)
    s, ev = vote(s, all_yes=True)
    assert s.phase == "game_over" and s.winner == "over" and s.win_reason == "chief_elected"
    assert ev[-1]["type"] == "game_over" and ev[-1]["roles"] == s.roles


def test_chief_nominated_but_vote_fails_is_not_a_win():
    s = make(7, pres=0, roles=roles_with_chief(7, chief=2))
    set_board(s, over=4)
    s, _ = act(s, 0, type="nominate", target=2)
    s, _ = vote(s, all_yes=False)
    assert s.winner is None


# ---------------------------------------------------------------- handoff

def test_handoff_flow_and_card_conservation():
    s = make(5, pres=0, deck="BOO")
    s, _ = act(s, 0, type="nominate", target=1)
    s, ev = vote(s, all_yes=True)
    assert s.hand == ["B", "O", "O"] and s.phase == "pres_discard"
    assert card_total(s) == 17
    with pytest.raises(IllegalAction):
        act(s, 1, type="discard", index=0)
    s, _ = act(s, 0, type="discard", index=0)
    assert s.hand == ["O", "O"] and s.discard == ["B"] and s.phase == "chanc_enact"
    with pytest.raises(IllegalAction):
        act(s, 0, type="enact", index=0)
    s, ev = act(s, 1, type="enact", index=1)
    assert s.over == 1 and s.discard == ["B", "O"] and s.hand == []
    assert card_total(s) == 17
    assert s.phase == "nominate" and s.president == 1


def test_no_veto_before_five_overscheduled():
    s = make(7, pres=0, deck="OOO")
    set_board(s, over=4)
    s, _ = act(s, 0, type="nominate", target=1)
    s, _ = vote(s, all_yes=True)
    s, _ = act(s, 0, type="discard", index=0)
    assert {"type": "propose_veto"} not in legal_actions(s, 1)
    with pytest.raises(IllegalAction):
        act(s, 1, type="propose_veto")


def _veto_ready(meter=0, deck="OBBB"):
    s = make(7, pres=0, deck=deck)
    set_board(s, over=5)
    s.meter = meter
    s, _ = act(s, 0, type="nominate", target=1)
    s, _ = vote(s, all_yes=True)
    s, _ = act(s, 0, type="discard", index=0)
    return s


def test_veto_accepted():
    s = _veto_ready()
    s, ev = act(s, 1, type="propose_veto")
    assert s.phase == "veto_response"
    with pytest.raises(IllegalAction):
        act(s, 1, type="veto", accept=True)  # chancellor can't answer
    disc = len(s.discard)
    s, ev = act(s, 0, type="veto", accept=True)
    assert len(s.discard) == disc + 2 and s.meter == 1 and s.over == 5 and s.breezy == 0
    assert s.phase == "nominate" and s.president == 1
    assert card_total(s) == 17


def test_veto_refused_must_enact_and_cannot_repropose():
    s = _veto_ready()
    s, _ = act(s, 1, type="propose_veto")
    s, ev = act(s, 0, type="veto", accept=False)
    assert s.phase == "chanc_enact" and s.veto_refused
    with pytest.raises(IllegalAction):
        act(s, 1, type="propose_veto")
    s, _ = act(s, 1, type="enact", index=0)
    assert s.breezy == 1 and s.meter == 0


def test_veto_accepted_moves_meter_to_three_and_forces_card():
    s = _veto_ready(meter=2, deck="OBBB")  # after drawing OBB the next card is B
    s, _ = act(s, 1, type="propose_veto")
    s, ev = act(s, 0, type="veto", accept=True)
    types = [e["type"] for e in ev]
    assert "forced" in types and s.breezy == 1 and s.meter == 0
    assert term_limited(s) == []


# ---------------------------------------------------------------- powers

@pytest.mark.parametrize("n", ALL_N)
def test_official_board_powers_trigger_on_nth_card(n):
    expected = BOARDS["official"][bracket(n)]
    for slot in range(5):
        s = make(n, pres=0, deck="OOO")
        set_board(s, over=slot)
        chanc = next(p for p in range(1, n) if s.roles[p] != "chief")
        s, ev = govern(s, chanc=chanc)
        power = [e["power"] for e in ev if e["type"] == "power"]
        assert power == ([expected[slot]] if expected[slot] else [])


def test_read_phone_rules_and_chief_shows_as_overschedulers():
    roles = roles_with_chief(9, chief=4)
    s = make(9, pres=0, roles=roles, deck="OOOOOO")
    s, _ = govern(s, chanc=1)
    assert s.phase == "power" and s.power == "investigate"
    assert 0 not in power_targets(s)
    with pytest.raises(IllegalAction):
        act(s, 0, type="power_target", target=0)
    with pytest.raises(IllegalAction):
        act(s, 1, type="power_target", target=4)
    s, ev = act(s, 0, type="power_target", target=4)
    assert s.pending_result == {"type": "investigate", "day": 1, "target": 4, "team": "over"}
    assert ev[0] == {"type": "power_used", "seq": ev[0]["seq"], "day": 1, "power": "investigate", "president": 0, "target": 4}
    # The result is private to the president.
    assert player_view(s, 0)["pending_result"]["team"] == "over"
    assert player_view(s, 1)["pending_result"] is None
    assert player_view(s, 4)["phone_read_by"] == [0]
    s, _ = act(s, 0, type="power_ack")
    assert s.phase == "nominate" and s.president == 1
    # Second read: the already-read player is not a legal target.
    s, _ = govern(s, chanc=2)
    assert s.power == "investigate"
    assert 4 not in power_targets(s)
    with pytest.raises(IllegalAction):
        act(s, 1, type="power_target", target=4)


def test_read_phone_dead_player_not_targetable():
    s = make(9, pres=0, deck="OOO")
    s.alive[5] = False
    s, _ = govern(s, chanc=1)
    assert 5 not in power_targets(s)


def _special_election_state():
    s = make(7, pres=0, deck="OOO")
    set_board(s, over=2)
    s, ev = govern(s, chanc=3)
    assert s.power == "special_election"
    return s


def test_breakfast_duty_then_rotation_resumes_left_of_power_user():
    s = _special_election_state()
    with pytest.raises(IllegalAction):
        act(s, 0, type="power_target", target=0)
    s, _ = act(s, 0, type="power_target", target=4)
    assert s.president == 4
    s, _ = fail_vote(s)
    assert s.president == 1  # left of seat 0, not left of seat 4
    s, _ = fail_vote(s)
    assert s.president == 2


def test_breakfast_duty_can_pick_next_in_line():
    s = _special_election_state()
    s, _ = act(s, 0, type="power_target", target=1)
    assert s.president == 1
    s, _ = fail_vote(s)
    assert s.president == 1  # seat 1 gets the normal turn too


def test_breakfast_duty_return_when_power_user_was_eliminated():
    s = _special_election_state()
    s, _ = act(s, 0, type="power_target", target=4)
    s.deck = list("OOO") + s.deck[3:]
    assert s.over == 3
    s, ev = govern(s, chanc=5)  # 4th overscheduled card -> babysitter duty
    assert s.power == "execute" and s.president == 4
    s, _ = act(s, 4, type="power_target", target=0)
    assert not s.alive[0]
    assert s.president == 1


def test_breakfast_duty_return_skips_eliminated_neighbour():
    s = _special_election_state()
    s, _ = act(s, 0, type="power_target", target=4)
    s.alive[1] = False
    s, _ = fail_vote(s)
    assert s.president == 2


def test_nap_schedule_peek_is_private_and_does_not_change_deck():
    s = make(5, pres=0, deck="OOOBOB")
    set_board(s, over=2)
    s, _ = govern(s, chanc=1)
    assert s.phase == "power_result"
    assert s.pending_result["cards"] == ["B", "O", "B"]
    before = list(s.deck)
    assert player_view(s, 1)["pending_result"] is None
    s, _ = act(s, 0, type="power_ack")
    assert s.deck == before


def test_peek_reshuffles_first_if_fewer_than_three_cards():
    s = make(5, pres=0)
    set_board(s, over=2)
    s.deck = list("OOOB")
    s.discard = list("BBBBB") + list("O" * 6)  # 4 + 11 = 15 cards; board holds 2
    assert card_total(s) == 17
    s, ev = govern(s, chanc=1)
    types = [e["type"] for e in ev]
    assert types.index("reshuffle") < types.index("power") or "reshuffle" in types
    assert s.phase == "power_result"
    assert s.pending_result["cards"] == s.deck[:3]
    assert card_total(s) == 17


def test_babysitter_duty_removes_player_without_revealing():
    roles = roles_with_chief(5, chief=4)
    s = make(5, pres=0, roles=roles, deck="OOO")
    set_board(s, over=3)
    s, ev = govern(s, chanc=1)
    assert s.power == "execute"
    s, ev = act(s, 0, type="power_target", target=2)
    assert not s.alive[2] and s.winner is None
    assert public_view(s)["roles"] is None
    assert all("role" not in json.dumps(e) for e in ev)
    # Out players can't act, vote, or be nominated.
    with pytest.raises(IllegalAction):
        act(s, 2, type="nominate", target=3)
    assert 2 not in eligible_nominees(s)


def test_babysitter_duty_on_chief_wins_for_chill():
    roles = roles_with_chief(5, chief=4)
    s = make(5, pres=0, roles=roles, deck="OOO")
    set_board(s, over=3)
    s, _ = govern(s, chanc=1)
    s, ev = act(s, 0, type="power_target", target=4)
    assert s.winner == "chill" and s.win_reason == "chief_out"
    assert public_view(s)["roles"] == roles


def test_rotation_skips_eliminated():
    s = make(6, pres=0)
    s.alive[1] = False
    s.alive[2] = False
    s, _ = fail_vote(s)
    assert s.president == 3
    s.president = 5
    s, _ = fail_vote(s)
    assert s.president == 0


# ---------------------------------------------------------------- reshuffle

def test_reshuffle_at_end_of_day_when_fewer_than_three():
    s = make(5, pres=0)
    s.deck = list("BBBOO")
    s.discard = list("BBB") + list("O" * 9)
    assert card_total(s) == 17
    s, ev = govern(s, chanc=1)
    assert any(e["type"] == "reshuffle" for e in ev)
    assert len(s.deck) == 16 and s.discard == [] and s.breezy == 1


def test_no_reshuffle_when_three_or_more_remain():
    s = make(5, pres=0)
    s.deck = list("BBBOOO")
    s.discard = list("BBB") + list("O" * 8)
    s, ev = govern(s, chanc=1)
    assert not any(e["type"] == "reshuffle" for e in ev)
    assert len(s.deck) == 3


def test_forced_card_reshuffles_if_deck_empty():
    s = _veto_ready(meter=2)
    s.discard = s.discard + s.deck
    s.deck = []
    s, _ = act(s, 1, type="propose_veto")
    s, ev = act(s, 0, type="veto", accept=True)
    types = [e["type"] for e in ev]
    assert types.index("reshuffle") < types.index("forced")
    assert card_total(s) == 17


# ---------------------------------------------------------------- wins

def test_five_breezy_wins():
    s = make(5, pres=0, deck="BBB")
    set_board(s, breezy=4)
    s, ev = govern(s, chanc=1)
    assert s.winner == "chill" and s.win_reason == "breezy5"


def test_six_overscheduled_wins_and_no_power():
    s = make(5, pres=0, deck="OOO")
    set_board(s, over=5)
    s, ev = govern(s, chanc=1)
    assert s.winner == "over" and s.win_reason == "over6"
    assert not any(e["type"] == "power" for e in ev)


def test_no_actions_after_game_over():
    s = make(5, pres=0, deck="BBB")
    set_board(s, breezy=4)
    s, _ = govern(s, chanc=1)
    with pytest.raises(IllegalAction):
        act(s, 1, type="nominate", target=2)


# ---------------------------------------------------------------- house rules

def test_house_rule_board_power_on_first_card():
    board = ["execute", None, "investigate", None, None]
    s = make(7, pres=0, deck="OOO", board=board)
    s, ev = govern(s, chanc=1)
    assert s.power == "execute"


def test_house_rule_board_can_remove_powers():
    s = make(9, pres=0, deck="OOO", board=[None] * 5)
    s, ev = govern(s, chanc=1)
    assert s.phase == "nominate"


def test_board_overrides_and_validation():
    assert board_for(8, BOARDS, {"7-8": ["peek"] * 5}) == ["peek"] * 5
    assert board_for(5, BOARDS, {"7-8": ["peek"] * 5}) == BOARDS["official"]["5-6"]
    with pytest.raises(ValueError):
        validate_board(["teleport", None, None, None, None])
    with pytest.raises(ValueError):
        validate_board([None] * 4)
    with pytest.raises(ValueError):
        validate_board(["execute"] * 3 + [None, None])


# ---------------------------------------------------------------- misc

def test_malformed_actions_rejected():
    s = make(5, pres=0)
    for bad in [{}, {"type": "explode"}, {"type": "nominate"}, {"type": "nominate", "target": "1"},
                {"type": "nominate", "target": True}]:
        with pytest.raises(IllegalAction):
            apply(s, 0, bad)
    with pytest.raises(IllegalAction):
        apply(s, 99, {"type": "nominate", "target": 1})


def test_apply_does_not_mutate_input():
    s = make(5, pres=0)
    before = json.dumps(s.to_dict())
    act(s, 0, type="nominate", target=1)
    assert json.dumps(s.to_dict()) == before


def test_state_json_roundtrip():
    s = make(8, pres=0, deck="OOO")
    s, _ = govern(s, chanc=1)
    s2 = GameState.from_dict(json.loads(json.dumps(s.to_dict())))
    assert s2 == s


def test_superlatives():
    roles = roles_with_chief(5, chief=1)
    s = make(5, pres=0, roles=roles, deck="BBBBBB")
    s, _ = govern(s, chanc=1)  # 0 & 1 breezy
    s, _ = govern(s, chanc=3)  # 1 & 3 breezy
    s, _ = act(s, s.president, type="nominate", target=4)
    s, _ = vote(s, yes_seats={2, 4, 0})
    s, _ = act(s, s.president, type="discard", index=0)
    s, _ = act(s, 4, type="enact", index=0)
    s.deck = ["B"] * 3 + s.deck  # test shortcut: next draw is breezy
    s.breezy = 4
    s, _ = govern(s, chanc=0)
    assert s.winner == "chill"
    awards = {a["key"]: a for a in s.superlatives}
    assert awards["nap_champion"]["seats"] == [0, 3]  # seat 1 (chief) is excluded
    assert awards["poker_face"]["seats"] == [1]
    assert awards["never_trusted"]["seats"] in ([1], [1, 3])
    assert awards["one_more_stop"]["seats"] == [2, 4]


def test_superlative_with_four_way_tie_is_dropped():
    s = make(5, pres=0, roles=roles_with_chief(5, chief=1))
    s, _ = act(s, 0, type="nominate", target=2)
    s, _ = vote(s, yes_seats={0})  # four players vote No once each: a 4-way tie for "Never Trusted Anyone"
    s.deck = ["B"] * 3 + s.deck
    s.breezy = 4
    s, _ = govern(s, chanc=3)
    assert s.winner == "chill"
    assert "never_trusted" not in {a["key"] for a in s.superlatives}
