# MTM2 / Community Patch 4: track changes, November 2026

What changed in Monster Truck Madness 2 tracks between Traxx 1.8.0 and the Traxx 1.8.2 beta
(Traxx `origin/main`, 2026-11-23), and what a tool must read and write to stay compatible.

Sources:

- the Traxx C++ source (`Traxx_OnGoing_Updates`, `origin/main` at 93419dd), which writes these files;
- the five drag templates Fila posted (`NewDrags_Templates.zip`: Straight, J, O, PaperClip and CrossOver drags, each as a `.txx` and a `.pod`), checked byte by byte against the C++;
- the MTM2.com forum thread "Traxx 1.8.2" (posts 60157 to 60203, 16 to 23 November 2026);
- the MTMG guild pages "Modern Traxx: Bigger Worlds" and "New-Style Drags".

The engine's own contract (`RACE_RULES_FORMAT.md` in the CP4 source) was not available. Byte layouts here come from the Traxx writer and reader, confirmed against the sample pods. Where the C++ and a sample disagree, this document says so. None did.

Contents:

1. [Summary](#1-summary)
2. [Which game reads what](#2-which-game-reads-what)
3. [Situation file: .SIT, .SI2, .SI3](#3-situation-file-sit-si2-si3)
4. [Track version record: DATA\\stem.TXV](#4-track-version-record-datastemtxv)
5. [Race rules: WORLD\\stem.CPX (new)](#5-race-rules-worldstemcpx-new)
6. [Walls](#6-walls)
7. [Race rules in play](#7-race-rules-in-play)
8. [Version 6 worlds as Traxx ships them](#8-version-6-worlds-as-traxx-ships-them)
9. [Traxx working file: TRAXXV21 to TRAXXV24](#9-traxx-working-file-traxxv21-to-traxxv24)
10. [Pod entry order](#10-pod-entry-order)
11. [Differences from our track format v6 proposal](#11-differences-from-our-track-format-v6-proposal)
12. [Things the public pages do not say](#12-things-the-public-pages-do-not-say)

---

## 1. Summary

| Change | Files | Needs |
|---|---|---|
| Up to 100 checkpoints (engine `MAX_CHECKPOINTS` 100, was 20) | `.SIT`/`.SI2`, `.TXV` | CP4 builds from 2026-11-15 when more than 20 |
| New-style drag: checkpoint roles, staged start, laps, walls, lead-ins | `.SI2`, `.TXV`, new `.CPX` | CP4 |
| New track type Parallel: two trucks, race start, wall touch = +5 s | `.SI2` (type 2), `.TXV`, `.CPX` | CP4 |
| Split checkpoints: one checkpoint on 2 to 8 boxes (any copy, or per lane) | `.SI2`, `.TXV`, `.CPX` | CP4 |
| Split checkpoints on circuits and rallies (race rules mode 3) | `.SI2`, `.TXV`, `.CPX` | CP4 |
| Walls: paths with height, bends and gaps, not checkpoint boxes | `.CPX` WALL/WPNT | CP4 |
| Lead-ins: a course driven once at the start, then the lane's course | `.CPX` COUR | CP4 |
| Version 6 worlds: 256 or 512 cells, heights to 8,192 ft, precise ground boxes, 16,384 objects | `.SI3`, `.TXV`, `_H.PNG`, 16-bit `.RA0`/`.RA1`, `.WTR`/`.WFL` v2 | CP4 |
| Traxx working file generations TRAXXV21 (race rules), V22 (walls), V23 (lead-ins), V24 (v6) | `.TXX` | Traxx 1.8.2 beta |

Old-style drags (the fixed checkpoint indices 0 to 7) and every classic track play exactly as before. Nothing is converted.

## 2. Which game reads what

A track is kept away from builds that cannot play it by the situation file's extension and by `.TXV` `legacyFallback=0`:

| Track | Situation file | Retail MTM2 | CP3 | CP4 |
|---|---|---|---|---|
| Classic, at most 20 checkpoints, no race rules, classic 8-bit heights, every texture with its 8-bit fallback | `WORLD\stem.SIT` | plays | plays | plays |
| Anything above that is not version 6 (race rules, more than 20 checkpoint boxes, 16-bit heights, an omitted fallback) | `WORLD\stem.SI2` | does not list it | lists some, runs race rules without rules or refuses them | plays |
| Version 6 (Standard or Tall, 256 or 512 cells) | `WORLD\stem.SI3` | does not list it | does not list it | plays |

Builds before 2026-11-15 write the 21st checkpoint past the end of a 20-entry list. Traxx warns about this and writes such a track as `.SI2`.

## 3. Situation file: .SIT, .SI2, .SI3

The text format did not change. Retail MTM2 parses it by position, so no line was added, removed or moved. New data goes in sidecar files keyed by checkpoint order.

- **Checkpoint order is box order.** The engine numbers checkpoints by the order of the type 6 boxes in the file. At Write POD, Traxx sorts the type 6 boxes stably by (checkpoint number, lane) and moves them among the type 6 positions, so the `.SI2` and the `.CPX` list them in the same order. Copies of a split checkpoint sit next to each other.
- **`Track Race Type`** (enum `NONE 0, DRAG 1, CIRCUIT 2, RALLY 3, KING 4`):
  - a new-style drag is written as 1;
  - **Parallel is written as 2 (Circuit)**: retail must never see a value it does not know, and the `.CPX` says Parallel;
  - race rules mode 3 keeps the author's 2 (Circuit) or 3 (Rally).
- **Objects:** at most 4,096 on a `.SIT`/`.SI2`, at most 16,384 on a `.SI3`.
- **Checkpoints:** at most 100 checkpoint slots. With race rules, a slot can hold up to 8 boxes (at most 800 type 6 boxes).

Sample `STRAIGHTDRAG.SI2` head (CRLF):

```
STRAIGHTDRAG.lvl
!Race Track Name
Straight Drag
...
Track Race Type
1
```

## 4. Track version record: DATA\stem.TXV

`formatVersion` is the highest of every rule that applies:

| formatVersion | Trigger |
|---|---|
| 2 | light or moving box types (2026-08-11) |
| 3 | a `.VEG` vegetation file |
| 4 | a fog volume (box type 14) |
| 5 | a 16-bit height file or a `terrainGrid` key |
| **6** | **race rules on** (`raceRules=` is written) |
| **6** | **more than 20 checkpoint boxes** (no key goes with it) |
| **6** | **a version 6 world** (the v6 keys below) |

So `formatVersion=6` alone does **not** mark a version 6 world. Only the four keys `worldCells`, `terrainHeightMap`, `terrainHeightStep` and `terrainHeightBase` do. A `.SIT` or `.SI2` whose `.TXV` carries any of those four is refused by Traxx: "this level is a version 6 level (its .TXV has %s), but its situation file is not a .SI3."

New key: `raceRules=drag|parallel|race`, written only with race rules on.

Key order as Traxx writes it:

```
# MTM2 track version record - written by Traxx
formatVersion=6
tool=Traxx
toolVersion=1.8.2
built=2026-11-21
legacyFallback=0
hdTextures=1
terrainGrid=spline|fine          (only for those grids; never "classic")
worldCells=256|512               (v6 only)
terrainHeightMap=DATA\STEM_H.PNG (v6 only)
terrainHeightStep=<1..128>       (v6 only)
terrainHeightBase=<0..32767>     (v6 only)
terrainHeights=...               (classic only, PNG heights; never on a .SI3)
fogVolumes=<n>
vegetation=1 / vegTrees / vegClumps
waterfalls=<n>
raceRules=drag|parallel|race
# carried over from the previous build
<keys Traxx does not own>
```

The v6 keys and `raceRules` count as Traxx's own, so a stale copy is never carried over. `legacyFallback` is 0 whenever the file is a `.SI2` or `.SI3`.

Sample `DATA\STRAIGHTDRAG.TXV` (162 bytes):

```
# MTM2 track version record - written by Traxx
formatVersion=6
tool=Traxx
toolVersion=1.8.2
built=2026-11-21
legacyFallback=0
hdTextures=1
raceRules=drag
```

## 5. Race rules: WORLD\stem.CPX (new)

Written only when race rules are on. The name is `WORLD\<STEM>.CPX`, upper case. Everything is little-endian, and every byte not listed is 0.

### 5.1 Header and directory

| Offset | Type | Value |
|---|---|---|
| 0 | char[4] | `MCPX` |
| 4 | u16 | major 1 (a reader refuses a higher one) |
| 6 | u16 | minor 0 (ignored) |
| 8 | u32 | header size 32 |
| 12 | u32 | chunk count |
| 16 | 16 bytes | flags and reserved, 0 |

The directory follows at the header size: chunk count entries of `char id[4]; u32 version (1); u32 offset; u32 size`. The order is fixed:

1. RULE
2. CPBX
3. WALL, then WPNT, when the track has walls
4. COUR, when the track has lead-ins (always last)

Chunks follow each other in that order with no padding. A reader skips unknown chunks and keeps the first of two with the same id.

Every chunk except RULE starts with an 8-byte list header: `u32 count; u16 recordSize; u16 0`. A reader takes the record size from the file, so later versions may lengthen records.

### 5.2 RULE (32 bytes)

| Offset | Type | Field |
|---|---|---|
| 0 | u16 | mode: 1 drag, 2 Parallel, 3 race (split checkpoints on a circuit or rally) |
| 2 | u16 | laps: drag 0 = looped (laps from the game menu), 1 = one run; Parallel and race 0 |
| 4 | u32 | time-out ms, 0 = the engine's default |
| 8 | u32 | wall penalty ms: 5000 (0 in mode 3) |
| 12 | u32 | re-arm ms: 1000 (0 in mode 3) |
| 16 | 16 bytes | reserved |

### 5.3 CPBX: one 24-byte record per type 6 box, in situation file order

| Offset | Type | Field |
|---|---|---|
| 0 | u16 | slot: the checkpoint number, 0-based, the same for every copy |
| 2 | u8 | role: 1 Pre-stage, 2 Stage, 3 Launch, 4 Finish, 5 Gate |
| 3 | u8 | split: 0 none, 1 any copy, 2 per lane |
| 4 | u8 | lane: 1 or 2 on a per-lane copy, else 0 |
| 5 | u8 | groundLine: 1 = paint the line; 0 on gates and everywhere in mode 3 |
| 6 | u16 | psi: round(psi rad x 65536 / 2 pi), wrapped to 0..65535 |
| 8 | i32 | x: round(.SIT x x 256) |
| 12 | i32 | y (height): round(.SIT middle field x 256) |
| 16 | i32 | z: round(.SIT third field x 256) |
| 20 | u32 | reserved |

Positions and psi are quantised from the exact `%.6f` text of the situation file, rounding half away from zero. A reader checks each record against the situation file's box. Traxx allows 16/256 ft on each axis and 64 psi units, and applies nothing if any box has moved ("the track was changed after the rules were written").

Roles come from the slot's place, never from the author:

- drag: slot 0 Pre-stage, 1 Stage, 2 Launch, the last slot Finish, every other slot Gate;
- Parallel and race: the last slot Finish, every other slot Gate.

Rules the writer enforces (the reader refuses the same things):

- at least 1 box, at most 100 slots and 800 boxes, at most 8 copies per slot;
- copies of a slot are next to each other and all have the same split;
- no split: exactly 1 box; any copy: 2 to 8 boxes; per lane: exactly 2 boxes, one in lane 1 and one in lane 2;
- a drag has at least 4 slots;
- in a drag, Pre-stage, Stage and Launch are never split as any copy. Either all three are per lane or none of them is. If they are per lane, every slot is per lane (that is how the O drag starts the trucks half a lap apart);
- mode 3 has no lanes, no walls and no lead-ins;
- laps: drag 0 or 1, the other modes 0.

### 5.4 WALL (48-byte records) and WPNT (24-byte records)

WALL:

| Offset | Type | Field |
|---|---|---|
| 0 | char[32] | name, at most 31 characters, zero-padded |
| 32 | u32 | first: index of the wall's first WPNT record (a running sum) |
| 36 | u16 | count of points |
| 38 | u8 | side: 0 none, 1 inside, 2 outside (commentary and line colour only) |
| 39 | u8 | flags: bit 0 closed, bit 1 no ground line |
| 40 | i32 | thickness, 1/256 ft, > 0 |
| 44 | i32 | height, 1/256 ft, > 0 |

WPNT:

| Offset | Type | Field |
|---|---|---|
| 0 | i32 | x, 1/256 ft |
| 4 | i32 | z, 1/256 ft |
| 8 | i32 | baseY: round(ground height in ft x 256 + above) |
| 12 | i32 | bend: sideways offset at mid-stretch, 1/256 ft (positive bulges toward (-dz, +dx)) |
| 16 | i32 | above: height above the ground, 1/256 ft |
| 20 | u8 | gap: 1 = the stretch after this point is open |

Limits: 64 walls, 1,024 points per wall, 8,192 points per pod, no stretch longer than 4,096 ft, every point inside the world (0 to cells x 32 ft). An open wall needs 2 points and a closed one 3. A bend is at most half its chord. Section 6 covers how the points are made.

### 5.5 COUR (8-byte records)

| Offset | Type | Field |
|---|---|---|
| 0 | u8 | course (2, 3 or 4) |
| 1 | u8 | flags: bit 0 first pass only (Traxx always sets it) |
| 2 | u8 | then course: 0 (Lane 1) or 1 (Lane 2) |
| 3 | 5 bytes | reserved |

Rules:

- at most one lead-in per lane;
- courses 0 and 1 are never lead-ins;
- a lead-in leads only to course 0 or 1.

A defective COUR is ignored and reported, and never fails the file.

### 5.6 Sample: STRAIGHTDRAG.CPX (5,144 bytes)

```
00  "MCPX" 0100 0000 20000000 04000000 + 16 x 00   v1.0, 4 chunks
20  RULE v1 off 0x60  size 0x20
30  CPBX v1 off 0x80  size 0x68   (8 + 4 x 24)
40  WALL v1 off 0xE8  size 0xC8   (8 + 4 x 48)
50  WPNT v1 off 0x1B0 size 0x1268 (8 + 196 x 24)
60  RULE: mode 1, laps 1 (one run), time-out 0, penalty 5000, re-arm 1000
88  CPBX slot 0 PS / slot 1 ST / slot 2 LA / slot 3 FIN, none split, groundLine 1,
    first x 0x0FDE80 = 4062.5 ft x 256 (the .SI2 says 4062.500000)
F0  WALL "Wall 1" first 0 count 49 side 2 flags 0 thickness 256 (1 ft) height 5120 (20 ft)
1B8 WPNT (0x102400, 0x0FE100) baseY 0xC800 (200 ft ground), then a point every 7.99 ft
```

`PAPERCLIPDRAG.CPX` (11,496 bytes, 5 chunks): looped (laps 0), 10 boxes in 5 per-lane slots, a closed wall, and COUR `{2, 1, 0}, {3, 1, 1}` (course 2 leads to Lane 1, course 3 to Lane 2).

## 6. Walls

A wall is an ordered list of points on the ground, each with a bend for the stretch after it, an above-ground offset and a gap flag. The wall has a thickness, a height, a side, a closed flag and a no-line flag. Walls belong to no lane and do not count as checkpoints. A wall stands on the terrain under each point (not on objects), plus that point's above-ground value, and rises by its height.

Defaults in Traxx: 1 ft thick, 20 ft tall, names `Wall 1`, `Wall 2`, and so on.

**Bends:** a bend b on a chord of length c is an arc with sagitta |b|. Its radius is (c²/4 + b²) / (2|b|), and its half turn is 2 atan(2|b| / c).

**The pod stores walls cut into pieces of about 8 ft.** Each stretch becomes k = ceil((arc length - 1/64 ft) / 8) pieces, each with its own small bend. A closed wall writes no closing duplicate point. The 1/64 ft of slack means a wall read back from a pod and written again keeps the same point count. A track opened from a pod therefore has walls made of many short pieces. The `.TXX` keeps the authored points and bends.

**Typed shapes** (Traxx's Wall window): set a start point and heading, then add straights by length and arcs by radius and angle. An arc longer than 180 degrees is split into pieces of at most 180 degrees.

## 7. Race rules in play

| | New-style drag | Parallel | Race (mode 3) |
|---|---|---|---|
| Trucks | 2 (lane 1, lane 2) | 2 | as the race |
| Start | staged: pre-stage, stage, launch beams | race start, no staging | race start |
| Checkpoints | in order; the next one only | in order | in order |
| Roles | PS, ST, LA, gates, Finish | gates, Finish | gates, Finish |
| Laps | one run, or looped with laps from the game menu | 0 (no lap control) | the race's |
| Pre-stage, Stage, Launch on later laps | ignored (may be driven over) | n/a | n/a |
| Wall touch | disqualified | +5 s, re-armed after 1 s clear | no walls |
| AI | lane course (lane 1 = course 0, lane 2 = course 1), lead-in first if any | same | as the race |
| Checkpoint height | bounded by the box's own height (a beam on a crossover bridge does not trigger for the truck under it) | same | as the race |

Old-style drags keep the fixed indices and the 33 s time-out: CP0 pre-stage, CP1 stage, CP2 launch, CP3 finish, CP4 to CP7 lane lines that disqualify.

Authoring notes Traxx enforces with warnings:

- a model-less checkpoint box on a drag or Parallel should be at least 8 ft tall;
- a lead-in course needs segments, and so does its lane's course;
- walls and lead-ins on a track without new-style drag or Parallel rules are kept in the `.TXX` but not written to the pod.

## 8. Version 6 worlds as Traxx ships them

Traxx now has an explicit **track kind**, set by File > New or Special > Track Type:

| Kind | World | Heights | Ground boxes | Objects | Situation file |
|---|---|---|---|---|---|
| Classic | 256 | 0 to 510 ft (2 ft steps) or 0 to 511.99 ft (16-bit grids) | 2 ft steps | 4,096 | `.SIT` / `.SI2` |
| Standard V6 | 256 or 512 | 0 to 511.99 ft | 1/128 ft | 16,384 | `.SI3` |
| Tall Heights V6 | 256 or 512 | 0 to 8,192 ft | 1/128 ft | 16,384 | `.SI3` |

Every 512-cell track is V6. Heights are never below 0.

Write POD for a V6 track:

- **Heights:**
  - always a 16-bit greyscale `DATA\<STEM>_H.PNG` (N x N, or 4N x 4N for the 8 ft Full Map grid), named by `terrainHeightMap`;
  - an 8-bit N x N `DATA\<STEM>.RAW` fallback, also always written: the `.LVL` names it, and the engine ignores it while a map is set;
  - a u16 `.RAW` map and an 8-bit PNG are never written.
- **Step and base:**
  - base = floor(lowest point in ft), refused below 0;
  - step = the largest power of two from 128 down to 1 with (highest - base) x step <= 65,535;
  - the span counts the terrain, ground boxes (a box with top 0 is skipped), the water when it is above 0, every lake and every fall;
  - the step and base are picked again on every write;
  - samples are floored: (h - base x 128) >> (7 - log2 step).
- **Ground boxes:**
  - `.RA0`/`.RA1` are always 16-bit samples on the same step and base (2 x N x N bytes);
  - a box top is at least 1 when its height is not 0.
- **Water:** `!waterHeight` goes in the `.LVL` whenever the water is above 0. Its range is 0 to 2 x (base + 65536 / step) half feet.
- **Lakes and waterfalls:**
  - `.WTR` and `.WFL` are major version 1 at 256 cells and 2 at 512;
  - on a 256-cell `.SI3` a lake or fall may sit anywhere in the track's height window, 2 x base + 1 to 2 x (base + 65536 / step) half feet, not only 1 to 4,096.

Traxx refuses to open a `.SI3` when the engine would refuse it. Exact messages are in the Traxx source.

- `.TXV` problems:
  - formatVersion below 6;
  - a bad worldCells, step or base value;
  - a 512-cell track with no `terrainHeightMap`;
  - a height map that cannot be used.
- `.SI3` with no height source: no map, no `terrainHeights` and no `.RAW`.
- Missing or wrongly sized grid files:
  - a missing `.CLR`;
  - a `.CLR`, `.LTE` or `.CL0` of the wrong size (the sizes are exact at 256 as well as 512);
  - a `.RA0` without `.RA1`;
  - a ground box pair without `.CL0`.
- A `!waterHeight` outside the track's range.
- Heights above 8,192 ft are lowered with a warning.

## 9. Traxx working file: TRAXXV21 to TRAXXV24

Traxx writes the lowest generation a track needs. Each generation also writes every block of the ones below it.

| Generation | Trigger | Adds |
|---|---|---|
| V21 | race rules on | two i32 at the end of **every** box record (`cp_split`, `cp_lane`, after V20's `allwx`); after the V19 water maps: `i32 1, i32 mode, i32 laps` |
| V22 | any wall | walls block: `i32 1, i32 n`, per wall `char[32] name, i32 side, closed, noline, thickness, height, npoints`, then npoints x `i32 x, z, bend, above, gap` |
| V23 | any lead-in | `i32 1, i32 leadin_then[5]` (-1 = none; [0] and [1] always -1) |
| V24 | V6 track | `i32 worldCells` just before the terrain; N x N terrain planes; ground box heights as two i32 in 1/128 ft; the heights block always 32-bit (no Classic 8-bit on V6); last, `i32 blockversion (2, or 3 with a stored lake map), i32 flags (bit 0 tall), i32 water4` and, in block 3, `i32 shown, i32 N x N, N x N bytes` of the pod's lake tile map |

The templates are TRAXXV22 (Straight, J, O, CrossOver: walls, no lead-ins) and TRAXXV23 (PaperClip). Traxx 1.8.0 and older refuse all four new generations.

## 10. Pod entry order

The same as before, with these additions:

```
... DATA\STEM.RA0 .. .RA5, DATA\STEM.RAW (8-bit, also on V6), DATA\STEM_H.PNG (V6) ...
... WORLD\STEM.SIT | .SI2 | .SI3, DATA\STEM.TXV, WORLD\STEM.VEG, WORLD\STEM.CPX (new),
WORLD\STEM.WTR, WORLD\STEM.WFL, WORLD\STEM.TXT
```

A pod holds at most 78 entries of Traxx's own (was 77).

## 11. Differences from our track format v6 proposal

Traxx adopted the proposal's names (`.SI3`, `worldCells`, `terrainHeightMap`, `terrainHeightStep`, `terrainHeightBase`, `.WTR`/`.WFL` v2). It departs from the proposal here:

| Proposal / JSTraxx 1.0.2 | Traxx 1.8.2 beta |
|---|---|
| a track is V6 when it uses a V6 feature | explicit kind: Classic, Standard V6, Tall Heights V6; a Standard V6 track with classic-range content is still a `.SI3` |
| negative heights, base -32768..32767 | no heights below 0; base 0..32767 |
| heights up to about 98,000 ft | 8,192 ft (Tall), 511.99 ft (Standard) |
| `formatVersion=6` means a V6 world | also written for race rules and for more than 20 checkpoint boxes; only the four V6 keys mean a V6 world |
| `terrainGrid=classic` written | never written |
| height map as a u16 `.RAW` or a PNG, 8-bit PNG allowed, no 8-bit fallback | always a 16-bit PNG, plus the 8-bit `.RAW` fallback |
| `.RA0`/`.RA1` 8-bit when the boxes fit | always 16-bit on write (8-bit still read) |
| step and base kept from the opened pod when they still fit | picked again on every write; water, lakes and falls count |
| samples rounded | samples floored |
| water under the ground does not move the base | any water above 0 counts |
| `.WTR`/`.WFL` v1 heights 1..4,096 | the track's height window on a 256-cell `.SI3` |
| v6 keys appended at the end of the `.TXV` | fixed position after `terrainGrid` |
| JSTraxx's own working file generation TRAXXV99 | TRAXXV24, which also holds race rules, walls and lead-ins |

## 12. Things the public pages do not say

- Parallel is stored as Track Race Type 2 (Circuit) plus `.CPX` mode 2. There is no new type number in the situation file.
- Old drags have no `.CPX`. A drag with a `.CPX` is a new-style drag. A failed `.CPX` check leaves a tool with the plain old-style track.
- Checkpoint roles are not stored by the author. They come from the slot's place, and a reader re-derives them.
- The `.CPX` is tied to the situation file by position fingerprints. Hand-editing the `.SI2` makes Traxx drop the rules on open.
- Ground lines are painted for Pre-stage, Stage, Launch and Finish only (groundLine 0 on gates). Mode 3 paints none.
- Lead-ins use courses 2 to 4, and lane courses are 0 and 1, so a drag or Parallel track has at most three lead-ins (one per lane in practice).
- More than 20 checkpoint boxes (copies included) makes any track `.SI2` with `formatVersion=6`, race rules or not.
- In the `.TXX`, `race_laps` is 1 when the rules are off. A wall-only TRAXXV22 file still carries the V21 block.
