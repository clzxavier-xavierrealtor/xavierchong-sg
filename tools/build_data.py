"""Assemble a project's data.json for the 3D site.

Inputs (per project):
  projects/<slug>.json          stacks (site-plan px), blocks, types, agent, cameras
  projects/<slug>.content.json  facilities, clubs, views, factsheet
  geo/fit.json                  site-plan px -> world metres (x east, z south)
  geo/lot.json                  OSM lot outline, bus stops, MRT exits (world metres)
  geo/osm-*.txt                 OSM surroundings (delta-encoded, world metres)
Output: ../3d-site/<slug>/data.json
"""
import json, math, re, sys, pathlib
from shapely.geometry import Polygon, Point

here = pathlib.Path(__file__).parent
slug = sys.argv[1] if len(sys.argv) > 1 else 'thomson-reserve'
P = json.loads((here / f'projects/{slug}.json').read_text())
K = json.loads((here / f'projects/{slug}.content.json').read_text())
fit = json.loads((here / 'geo/fit.json').read_text())
lot = json.loads((here / 'geo/lot.json').read_text())
M, t = fit['M'], fit['t']

def W(px, py):
    return [round(M[0][0]*px + M[0][1]*py + t[0], 2), round(M[1][0]*px + M[1][1]*py + t[1], 2)]

r1 = lambda v: round(v, 1)

# ---------- stacks & blocks ----------
F = P['stackFields']
stacks = {}
for no, row in P['stacks'].items():
    s = dict(zip(F, row))
    x, z = W(s['px'], s['py'])
    stacks[no] = [s['block'], x, z, s['fromFloor'], s['toFloor'], s['type'], s['pFloor']]
# block orientation: plan angle + fitted rotation
rot = fit['rotDeg']
blocks = []
for b in P['blocks']:
    bb = dict(b)
    bb['angle'] = b['angle'] + rot
    bb['label'] = W(*b['label'])
    blocks.append(bb)

# ---------- site ----------
lotpts = list(zip(lot['lot'][0::2], lot['lot'][1::2]))
lotpoly = Polygon(lotpts).buffer(5, join_style=2)
platform = [[r1(x), r1(z)] for x, z in list(lotpoly.exterior.coords)[:-1]]
deck = Polygon([W(*p) for p in K['deck_px']]).intersection(lotpoly)
deck = deck if deck.geom_type == 'Polygon' else max(deck.geoms, key=lambda g: g.area)
deckpts = [[r1(x), r1(z)] for x, z in list(deck.simplify(1).exterior.coords)[:-1]]
water = [[W(*p) for p in poly] for poly in P['water']]
roads_plan = []  # site roads come from OSM now

facilities = []
for n, name, club, px, py, kind in K['facilities_px']:
    x, z = W(px, py)
    facilities.append({'n': n, 'name': name, 'club': club, 'x': x, 'z': z, 'kind': kind,
                       'info': K['facility_info'].get(str(n), ''), 'img': K['facility_images'].get(str(n), '')})
club_buildings = [{'name': c['name'], 'pts': [W(*p) for p in c['pts']], 'depth': c['depth'] / P['plan']['pxPerM'], 'storeys': c['storeys']}
                  for c in K['club_buildings_px']]

# ---------- OSM surroundings ----------
def dec(s):
    out, x, z = [], 0, 0
    for i, q in enumerate(s.split(' ')):
        a, b = map(int, q.split(','))
        x, z = (a, b) if i == 0 else (x + a, z + b)
        out.append([x, z])
    return out

over = dict(K.get('osm_heights', []))
B, R, A, N = [], [], [], []
for f in ('geo/osm-a.txt', 'geo/osm-b.txt'):
    for line in (here / f).read_text().splitlines():
        if not line or line[0] == '#':
            continue
        p = line.split('|')
        if p[0] == 'B':
            ty, lv, name, pts = p[1], p[2], p[3], dec(p[4])
            if len(pts) < 3:
                continue
            poly = Polygon(pts)
            if not poly.is_valid:
                poly = poly.buffer(0)
            if poly.is_empty or poly.intersects(lotpoly):
                continue
            area = poly.area
            if name in over:
                lvl = over[name]
            elif lv:
                lvl = float(lv)
            elif ty == 'h':
                lvl = 2.5
            elif ty == 'r':
                lvl = 12 if area > 600 else 3
            elif ty == 'f':
                lvl = 1
            else:
                lvl = 4 if area > 1500 else 3 if area > 300 else 2
            B.append([ty, lvl, name, [c for pt in pts for c in pt]])
        elif p[0] == 'R':
            cls, lanes, oneway, name, pts = p[1], p[2], p[3], p[4], dec(p[5])
            R.append([cls, int(lanes) if lanes else 0, int(oneway), name, [c for pt in pts for c in pt]])
        elif p[0] == 'A':
            kind, name, pts = p[1], p[2], dec(p[3])
            if len(pts) >= 3 and not Polygon(pts).buffer(0).within(lotpoly):
                A.append([kind, name, [c for pt in pts for c in pt]])
        elif p[0] == 'N':
            N.append([p[1]] + dec(p[2])[0])

stops = [[s[1], s[2], s[3], s[4]] for s in lot['stops'] if s[0] == 'bus_stop']
mrt = [[s[1], s[2], s[3], s[4]] for s in lot['stops'] if s[0] == 'mrt_exit']


# ---------- indicative prices (optional) ----------
prices, stack_info, price_meta = {}, {}, None
px = here / f'projects/{slug}.prices.xlsx'
if px.exists():
    import openpyxl
    wb = openpyxl.load_workbook(px, data_only=True, read_only=True)
    ws = wb['All Units']
    flags = []
    C16 = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
    for r in ws.iter_rows(min_row=5, values_only=True):
        if not r[0] or not str(r[0]).startswith('#'):
            continue
        key = str(r[0])[1:]
        fl = r[18] or ''
        if fl and fl not in flags:
            flags.append(fl)
        prices[key] = [int(r[17]), int(round(r[16])), flags.index(fl) if fl else -1]
        st = '%02d' % int(r[2])
        if st not in stack_info:
            txt = (r[19] or '').strip()
            m = re.match(r'^([NSEW]{1,3})\.\s*', txt)
            b = C16.index(m.group(1)) * 22.5 if m and m.group(1) in C16 else None
            stack_info[st] = {'tier': r[8], 'facing': txt[m.end():] if m else txt, 'compass': m.group(1) if m else '', 'bearing': b}
    price_meta = {'source': 'Indicative price model by Tricia Ong & Angus Lim (PropNex), 20 Oct 2026, built on the developer starting prices and the project chief floor guide.',
                  'note': 'Estimates for discussion only. Not the developer\'s official price list; actual prices may differ by stack and floor.',
                  'flags': flags,
                  'tiers': {'A': 'Trophy stack', 'B': 'Inner pool facing or long pool vistas', 'C': 'Road side or west sun, with landed or nature views', 'D': 'Drop-off, road or boundary side', 'E': 'Faces the HDB estate or Thomson Three'}}
    assert len(prices) == P['expectTotal'], len(prices)

# ---------- views / outlook ----------
data = {
    'slug': P['slug'], 'name': P['name'], 'subtitle': P['subtitle'],
    'geo': {'lat0': lot['origin'][0], 'lon0': lot['origin'][1], 'rotDeg': rot},
    'storeyHeight': P['storeyHeight'], 'platformHeight': 8, 'deckHeight': 4.3,
    'unitSize': P['unitSize'],
    'platform': platform, 'deck': deckpts, 'water': water,
    'blocks': blocks, 'collections': P['collections'],
    'stackFields': ['block', 'x', 'z', 'fromFloor', 'toFloor', 'type', 'pFloor'],
    'stacks': stacks, 'expectTotal': P['expectTotal'],
    'typeCatalogue': P['typeCatalogue'], 'groups': P['groups'],
    'facilities': facilities, 'clubs': K['clubs'], 'clubBuildings': club_buildings,
    'osm': {'B': B, 'R': R, 'A': A, 'N': N, 'attribution': '© OpenStreetMap contributors'},
    'transit': {'stops': stops, 'mrt': mrt},
    'views': K['views'], 'viewGroups': K['view_groups'], 'outlook': K['outlook_by_bearing'],
    'facts': P['facts'], 'lede': P['lede'], 'factsheet': K['factsheet'], 'maintenance': K['maintenance'],
    'shareByGroup': K['share_by_group'],
    'prices': prices, 'stackInfo': stack_info, 'priceMeta': price_meta,
    'agent': P['agent'], 'disclaimer': P['disclaimer'],
}
total = sum(r[4] - r[3] + 1 for r in stacks.values())
assert total == P['expectTotal'], total
out = here.parent / 'site' / slug / 'data.json'
out.write_text(json.dumps(data, separators=(',', ':'), ensure_ascii=False))
print(out, len(out.read_bytes()) // 1024, 'KB', 'units', total, 'buildings', len(B), 'roads', len(R), 'areas', len(A))
