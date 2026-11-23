"""One-off wording update for the explainer (daily agendas, outcome-based rails, Overscheduled stamp)."""
import os
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'explainer.html')
s = open(p).read()
R = [
    ("'Every day, one card gets played: a Breezy Day or an Overscheduled Day.'", "'Every day, one daily agenda gets played: Breezy or Overscheduled.'"),
    ("'Chill Parents win with 5 Breezy Days. Overschedulers win with 6 Overscheduled Days.'", "'Five Breezy Agendas and the Chill Parents win. Six Overscheduled Agendas and the Overschedulers win.'"),
    ("'Every card played is stamped on the board for everyone to see.'", "'Every agenda played is stamped on the board for everyone to see.'"),
    ("'If the vote passes, the First One Awake secretly draws three cards.'", "'If the vote passes, the First One Awake secretly draws three daily agendas.'"),
    ("'Three in a row and the babies decide: the top card is played automatically.'", "'Three in a row and the babies decide: the top agenda is played automatically.'"),
    ("'The deck has 6 Breezy Days and 11 Overscheduled Days.'", "'The deck has 6 Breezy Agendas and 11 Overscheduled Agendas.'"),
    ("'Overscheduled Days unlock powers for the First One Awake.'", "'Overscheduled Agendas unlock powers for the First One Awake.'"),
    ("'Careful: after 3 Overscheduled Days, if the Chief becomes Day Planner…'", "'Careful: after 3 Overscheduled Agendas, if the Chief becomes Day Planner…'"),
    ("'Your phone is private: your role, your cards, your turn.'", "'Your phone is private: your role, your agendas, your turn.'"),
    ("Breezy Days · 5 to win</h4>", "Breezy Agendas · 5 for the best trip ever</h4>"),
    ("Overscheduled Days · 6 to lose</h4>", "Overscheduled Agendas · 6 for a meltdown</h4>"),
    ("${I('breezy')} Breezy · 5 to win</h4>", "${I('breezy')} Breezy · 5 = best trip ever</h4>"),
    ("${I('over')} Overscheduled · 6 to lose</h4>", "${I('over')} Overscheduled · 6 = meltdown</h4>"),
    ("<span class=\"k\">Day card</span><span class=\"t\">${k === 'B' ? 'Breezy Day' : 'Overscheduled Day'}</span>",
     "<span class=\"k\">Daily agenda</span><span class=\"t\">${k === 'B' ? 'Breezy Agenda' : 'Overscheduled Agenda'}</span>"),
    ("<span>Overscheduled Day 2 of 6</span>", "<span>Overscheduled Agenda 2 of 6</span>"),
    ('.rail.O .ticket .stamp { font-size: 15px; padding: 2px 5px; }', '.rail.O .ticket .stamp { font-size: 13px; padding: 2px 4px; letter-spacing: 0.04em; }'),
    ("<span class=\"stamp r\" style=\"opacity:1;font-size:10px;border-width:3px;padding:1px 4px\">Overbooked</span>",
     "<span class=\"stamp r\" style=\"opacity:1;font-size:8px;border-width:2px;padding:1px 3px;letter-spacing:0\">Overscheduled</span>"),
]
for a, b in R:
    assert a in s, a[:70]
    s = s.replace(a, b)
s = s.replace('>Overbooked</span>', '>Overscheduled</span>')
s = s.replace("? 'Breezy' : 'Overbooked'}", "? 'Breezy' : 'Overscheduled'}")
s = s.replace("'Overbooked'", "'Overscheduled'")
open(p, 'w').write(s)
print('remaining Overbooked:', s.count('Overbooked'), '| Breezy Day:', s.count('Breezy Day'), '| Overscheduled Day:', s.count('Overscheduled Day'))
