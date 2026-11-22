"""Print a sample game transcript in theme words: python scripts/sample_game.py [players] [seed]"""
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.boards import board_for, load_boards  # noqa: E402
from engine.game import apply, legal_actions, new_game, waiting_on  # noqa: E402

NAMES = ["Sarah", "Tom", "Priya", "Jess", "Marco", "Ana", "Dev", "Lena", "Sam", "Kit"]


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 8
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    theme = json.loads((ROOT / "themes" / "wine_or_whine.json").read_text())
    T, L = theme["terms"], theme["log"]
    r = random.Random(seed)
    s, events = new_game(n, seed, board_for(n, load_boards()))
    name = NAMES[:n]
    role_word = {"chill": T["chill_one"], "over": T["over_one"], "chief": T["chief"]}
    print(f"== {theme['name']}: {n} players, seed {seed} ==")
    print("Secret roles (for this transcript only): " + ", ".join(f"{name[p]}={role_word[x]}" for p, x in enumerate(s.roles)))
    card_a = {"B": T["breezy_a"], "O": T["over_a"]}

    def fmt(t, **kw):
        out = t
        for k, v in kw.items():
            out = out.replace("{" + k + "}", str(v))
        return out

    all_events = list(events)
    while s.phase != "game_over":
        seat = r.choice(waiting_on(s))
        acts = legal_actions(s, seat)
        # Lean towards "yes" votes so the transcript shows governments.
        a = r.choice([x for x in acts if x.get("yes") is not False] if r.random() < 0.7 else acts)
        s, events = apply(s, seat, a)
        all_events += events
    for e in all_events:
        t = e["type"]
        if t == "day_start":
            print("\n" + fmt(L["day_start"], day=e["day"], pres=name[e["president"]]))
        elif t == "nominated":
            print("  " + fmt(L["nominated"], pres=name[e["president"]], nominee=name[e["nominee"]]))
        elif t == "vote_result":
            print("  " + fmt(L["vote_pass" if e["passed"] else "vote_fail"], yes=e["yes"], no=e["no"]))
        elif t == "meter":
            print("  " + fmt(L["meter"], value=e["value"]))
        elif t == "forced":
            print("  " + fmt(L["forced"], card_a=card_a[e["card"]]))
        elif t == "enacted":
            caption = theme["tracks"]["breezy" if e["card"] == "B" else "over"][e["count"] - 1]
            print("  " + fmt(L["enacted"], Card_a=card_a[e["card"]].capitalize(), caption=caption))
        elif t == "veto_proposed":
            print("  " + fmt(L["veto_proposed"], planner=name[e["chancellor"]]))
        elif t == "veto_result":
            print("  " + fmt(L["veto_accepted" if e["accepted"] else "veto_refused"], pres=name[e["president"]]))
        elif t == "power_used":
            print("  " + fmt(L["power_" + e["power"]], pres=name[e["president"]], target=name[e["target"]]))
        elif t == "power" and e["power"] == "peek":
            print("  " + fmt(L["power_peek"], pres=name[e["president"]]))
        elif t == "reshuffle":
            print("  " + L["reshuffle"])
        elif t == "game_over":
            title = theme["winner_title"][e["winner"]]
            print("\n" + fmt(L["game_over"], title=title) + " " + theme["win"][e["reason"]])
            for a in e["superlatives"]:
                print(f"  🏆 {theme['superlatives'][a['key']]['title']}: " + ", ".join(name[p] for p in a["seats"]))


if __name__ == "__main__":
    main()
