# Narration for the explainer: one Kokoro clip per caption (plus title and closing lines), a time map that
# stretches each caption window just enough to fit its line, and a narration track laid out on the new timeline.
import json, re
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

import os
D = os.path.dirname(os.path.abspath(__file__)) + '/'
M = os.environ.get('KOKORO_DIR', D + 'models/').rstrip('/') + '/'  # kokoro-v1.0.onnx and voices-v1.0.bin
VOICE, SPEED = 'af_heart', 1.0
LEAD, TAIL = 0.3, 0.5

html = open(D + 'explainer.html').read()
cap = html[html.index('const CAP = ['):html.index(']\nfor (const [t0, t1, n, label]')]
caps = [{'t0': float(a), 't1': float(b), 'text': t.replace("\\'", "'")} for a, b, _, t in re.findall(r"\[([\d.]+), ([\d.]+), (['\"])(.*?)\3\]", cap)]
lines = [{'t0': 0.8, 't1': 6.0, 'text': "Wine or Whine. Here's how to play."}] + caps + \
        [{'t0': 165.8, 't1': 174.0, 'text': "Ready? Let's find out who really wants one more winery. Scan the code on the TV to join."}]


def spoken(t: str) -> str:
    t = t.replace('YES', 'yes').replace('NO,', 'no,').replace('NO ', 'no ').replace('…', '...')
    return re.sub(r'\s+', ' ', t).strip()


k = Kokoro(M + 'kokoro-v1.0.onnx', M + 'voices-v1.0.bin')
SR = None
for i, l in enumerate(lines):
    audio, sr = k.create(spoken(l['text']), voice=VOICE, speed=SPEED, lang='en-us')
    SR = sr
    # trim leading/trailing near-silence
    idx = np.where(np.abs(audio) > 0.01)[0]
    if len(idx):
        audio = audio[max(0, idx[0] - int(0.03 * sr)): idx[-1] + int(0.08 * sr)]
    l['clip'] = audio
    l['dur'] = len(audio) / sr

# Time map: old (animation) time -> new (video) time. Windows grow to fit their line; gaps keep their length.
lines.sort(key=lambda l: l['t0'])
anchors = [(0.0, 0.0)]
old_t = new_t = 0.0
for l in lines:
    if l['t0'] > old_t:  # gap
        new_t += l['t0'] - old_t
        old_t = l['t0']
        anchors.append((old_t, new_t))
    start = max(l['t0'], old_t)
    old_len = l['t1'] - start
    new_len = max(old_len, LEAD + l['dur'] + TAIL)
    l['new_start'] = new_t + LEAD
    new_t += new_len
    old_t = l['t1']
    anchors.append((old_t, new_t))
END_OLD = 174.5
new_t += END_OLD - old_t
anchors.append((END_OLD, new_t))
total = round(new_t + 0.5, 2)

track = np.zeros(int(total * SR) + SR, dtype=np.float32)
for l in lines:
    a = int(l['new_start'] * SR)
    track[a:a + len(l['clip'])] += l['clip']
sf.write(D + 'narration.wav', track[: int(total * SR)], SR)
json.dump({'anchors': anchors, 'total': total}, open(D + 'timemap.json', 'w'))
over = [(round(l['t0'], 1), round(l['dur'], 2), round(l['t1'] - l['t0'], 2)) for l in lines if l['dur'] + LEAD + TAIL > l['t1'] - l['t0']]
print('total new length', total, 's; stretched windows:', len(over))
print(over[:40])
