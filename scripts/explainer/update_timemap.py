"""Copy timemap.json (from voice.py) into explainer.html's TMAP constant."""
import json, os
D = os.path.dirname(os.path.abspath(__file__))
s = open(os.path.join(D, 'explainer.html')).read()
tm = json.load(open(os.path.join(D, 'timemap.json')))
i = s.index('const TMAP = ')
j = s.index('\n', i)
s = s[:i] + 'const TMAP = ' + json.dumps(tm['anchors']) + s[j:]
open(os.path.join(D, 'explainer.html'), 'w').write(s)
print('total', tm['total'])
