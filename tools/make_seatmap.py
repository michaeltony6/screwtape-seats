#!/usr/bin/env python3
"""Seat map for the NBPAC Elizabeth Ross Johnson Theater with our booked seats highlighted.
Geometry is measured from the lobby seating-chart photo (photo pixel coordinates), then scaled."""
import math, sys

OUT = sys.argv[1]

BOOKED = {
    ('BAL', 'C'): set(range(202, 229)),
    ('BAL', 'B'): set(range(213, 229)),
    ('BAL', 'A'): set(range(213, 229)),
    ('MID', 'L'): set(range(106, 128)),
    ('MID', 'K'): set(range(108, 127)),
}
TOTAL = sum(len(v) for v in BOOKED.values())
assert TOTAL == 100, TOTAL

W = 1100
S = 1.3                      # photo px -> svg units
AXIS = 615                   # common center line (photo x)
TOP = 36                     # svg y of photo y 340
def X(x): return (x - AXIS) * S + W / 2
def Y(y): return (y - 340) * S + TOP

seats, labels = [], []
SW, SH = 21, 19              # seat size in photo units

def add(section, row, num, x, y, rot):
    seats.append((section, row, num, X(x), Y(y), rot))

def arc_row(section, row, nums, apex_y, R, pitch, cx=AXIS, label=True):
    n = len(nums)
    step = pitch / R
    pts = []
    for i, num in enumerate(nums):
        t = (i - (n - 1) / 2) * step
        x = cx + R * math.sin(t)
        y = apex_y + R * (1 - math.cos(t))
        add(section, row, num, x, y, math.degrees(t))
        pts.append((x, y, t))
    if label:
        for (x, y, t), side in ((pts[0], -1), (pts[-1], 1)):
            lx = x + side * (SW * 0.5 + 12) * math.cos(t)
            ly = y + side * (SW * 0.5 + 12) * math.sin(t)
            labels.append(('row', row, X(lx), Y(ly) + 1, section))

def column(section, row, nums, start, step, rot):
    for i, num in enumerate(nums):
        add(section, row, num, start[0] + step[0] * i, start[1] + step[1] * i, rot)

def mirror_x(x, axis=AXIS): return 2 * axis - x

# ── Balcony: rows C (back), B, A; seats 201–228 left to right ──
for row, apex in (('C', 352), ('B', 398), ('A', 444)):
    arc_row('BAL', row, list(range(201, 229)), apex, 1275, 22.8)
labels.append(('section', 'BALCONY', X(AXIS), Y(512), None))

# balcony AA boxes and balcony boxes (photo positions, mirrored about the axis)
column('BAL', 'AA', [2, 4, 6, 8], (258, 511), (-9.3, 21.7), 23)
column('BAL', 'AA', [1, 3, 5, 7], (mirror_x(258), 511), (9.3, 21.7), -23)
labels.append(('small', 'AA', X(270), Y(590), None))
labels.append(('small', 'AA', X(mirror_x(270)), Y(590), None))
column('BBR', '', [208, 206, 204, 202], (233, 643), (15.7, 35.7), -24)
column('BBL', '', [207, 205, 203, 201], (mirror_x(233), 643), (-15.7, 35.7), 24)
labels.append(('small2', 'BALCONY|BOX RIGHT', X(262), Y(782), None))
labels.append(('small2', 'BALCONY|BOX LEFT', X(mirror_x(262)), Y(782), None))

# ── Center section: rows L (back) to H ──
arc_row('MID', 'L', list(range(101, 128)), 706, 1000, 21.8)
arc_row('MID', 'K', list(range(101, 127)), 746, 1000, 21.8)
arc_row('MID', 'J', list(range(101, 127)), 786, 1000, 21.8)
arc_row('MID', 'H', list(range(101, 127)), 826, 1000, 21.8)

# ── Orchestra center, concentric around a point near the stage ──
YC = 1560
for row, apex, last in (('G', 872, 118), ('F', 910, 118), ('E', 946, 117), ('D', 982, 116), ('C', 1018, 115), ('B', 1052, 114), ('A', 1086, 113)):
    arc_row('ORC', row, list(range(101, last + 1)), apex, YC - apex, 21.5)
for row, apex, last in (('CC', 1143, 111), ('BB', 1178, 110), ('AA', 1213, 109)):
    arc_row('ORC', row, list(range(101, last + 1)), apex, YC - apex, 21.5)
labels.append(('section', 'ORCHESTRA', X(AXIS), Y(1268), None))

# orchestra side sections: even seats house right (left on the map), odd seats house left
WEDGE = [('F', 391, 958, 5), ('E', 403, 990, 6), ('D', 414, 1022, 7), ('C', 429, 1059, 7), ('B', 444, 1095, 7), ('A', 460, 1131, 7),
         ('CC', 460, 1187, 5), ('BB', 473, 1218, 5), ('AA', 482, 1250, 4)]
for row, x, y, n in WEDGE:
    column('ORL', row, [2 * (i + 1) for i in range(n)], (x, y), (-21.3, 10.3), -25.8)
    column('ORR', row, [2 * i + 1 for i in range(n)], (mirror_x(x), y), (21.3, 10.3), 25.8)

# boxes
column('BXR', '', [10, 8, 6, 4, 2], (243, 1072), (13, 34.5), -21)
column('BXL', '', [9, 7, 5, 3, 1], (mirror_x(243), 1072), (-13, 34.5), 21)
labels.append(('small', 'BOX RIGHT', X(272), Y(1244), None))
labels.append(('small', 'BOX LEFT', X(mirror_x(272)), Y(1244), None))


# ── export for the website ──
import json
SEC_ID = {'BAL': 'BAL', 'MID': 'CTR'}
out_seats = []
for sec, row, num, x, y, rot in seats:
    ours = num in BOOKED.get((sec, row), ())
    sid = f"{SEC_ID.get(sec, sec)}-{row}-{num}" if ours else None
    out_seats.append({'x': round(x, 1), 'y': round(y, 1), 'r': round(rot, 2), 'n': num, 'row': row, 'sec': sec, 'id': sid})
out_labels = [{'k': k, 't': t, 'x': round(x, 1), 'y': round(y, 1), 'on': (k == 'row' and any(b[1] == t and b[0] == s for b in BOOKED))} for k, t, x, y, s in labels]
MAP_BOTTOM = Y(1300)
data = {'w': W, 'h': round(MAP_BOTTOM + 110), 'seatW': round(SW * S, 1), 'seatH': round(SH * S, 1), 'stageY': round(MAP_BOTTOM + 34), 'seats': out_seats, 'labels': out_labels}
open(OUT, 'w').write('/* Generated by tools/make_seatmap.py from the NBPAC lobby seating chart. Do not edit by hand. */\nwindow.SEATMAP = ' + json.dumps(data, separators=(',', ':')) + ';\n')
print('seats', len(out_seats), 'ours', sum(1 for s in out_seats if s['id']))
