/*
  The .TXX working file. The fixtures are laid out field by field as Traxx 1.6.7's SaveBinary
  writes them (TrackPOD/TrackPODBinary.cpp and the component Save functions), independently of
  the codec, so reading one and writing it back must give the same bytes.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readTxx, TxxError, txxVersionFor, writeTxx } from "../src/core/traxx/txx.ts";
import type { TxxTrack } from "../src/core/traxx/txx.ts";

/** A little-endian byte builder, written for these fixtures only. */
class Bytes {
  out: number[] = [];
  u8(v: number) { this.out.push(v & 0xff); return this; }
  i16(v: number) { return this.u8(v).u8(v >> 8); }
  i32(v: number) { return this.u8(v).u8(v >> 8).u8(v >> 16).u8(v >> 24); }
  f32(v: number) { const b = new Uint8Array(new Float32Array([v]).buffer); for (const x of b) this.u8(x); return this; }
  raw(text: string) { for (const c of text) this.u8(c.charCodeAt(0)); return this; }
  str(text: string) { return this.u8(text.length + 1).raw(text).u8(0); }
  blob(data: number[] | null) { this.i32(data ? data.length : 0); if (data) for (const x of data) this.u8(x); return this; }
  pad(n: number, v = 0) { for (let i = 0; i < n; i++) this.u8(v); return this; }
  bytes() { return Uint8Array.from(this.out); }
}

/** Traxx's terrain run-length coding of one plane: runs of at most 255, then a 0. */
function rle(b: Bytes, values: number[]) {
  let i = 0;
  while (i < values.length) {
    let run = 1;
    while (i + run < values.length && values[i + run] === values[i] && run < 255) run++;
    b.u8(run).u8(values[i]);
    i += run;
  }
  b.u8(0);
}

interface FixtureBox { type: number; model?: string; sounds?: [string, string]; light?: boolean; crush?: boolean }

function box(b: Bytes, version: number, spec: FixtureBox) {
  b.i32(1000).i32(2000).i32(30);
  b.f32(0).f32(0).f32(0.5);
  b.i32(64).i32(64).i32(20);
  b.f32(12.5);
  b.f32(1).f32(2).f32(3);
  b.f32(0).f32(0.25).f32(0);
  b.i32(spec.type).i32(0).i32(1).i32(spec.type === 6 ? 0 : 0).i32(4);
  const [cont, impact] = spec.sounds ?? ["NULL.WAV", "NULL.WAV"];
  b.i32(3);
  for (const name of [cont, impact]) {
    if (version >= 4) b.str(name);
    else { b.raw(name); b.pad(12 - name.length); }
  }
  b.i16(64).i16(4 | (8 << 8));
  b.str(spec.model ?? "");
  if (spec.crush) { b.str("CPCRUB1.BIN"); b.f32(0).f32(0).f32(4); }
  if (version >= 3) {
    b.f32(spec.light ? 80 : 64).f32(8).f32(1).f32(1).f32(1).i32(0).f32(6).f32(125).f32(10).f32(3.5);
  }
  if (version >= 5) b.f32(spec.light ? 1.25 : 1);
  if (version >= 6) b.f32(0);
}

function terrain(b: Bytes) {
  const heights = Array.from({ length: 65536 }, (_, i) => (i < 300 ? 120 : 100));
  const clr = Array.from({ length: 65536 }, (_, i) => (i % 256 === 0 ? 0xd005 : 3));
  b.i16(0x8007);
  rle(b, heights);
  rle(b, clr.map((w) => w & 0xff));
  rle(b, clr.map((w) => w >> 8));
  for (let p = 0; p < 7; p++) rle(b, Array.from({ length: 65536 }, () => (p === 0 ? 237 : 0)));
}

function truck(b: Bytes, name: string, course: number) {
  b.i32(4000).i32(6000).i32(50).f32(0).f32(0).f32(1.5).i32(course).i32(0).i32(0).i32(0).i32(0).str(name);
}

/** A track laid out as SaveBinary writes it, at `version`, with the fields that version adds. */
function fixture(version: number, boxes: FixtureBox[], options: { arena?: boolean; quarters?: number } = {}): Uint8Array {
  const b = new Bytes();
  b.raw(`TRAXXV${version}`).pad(10 - `TRAXXV${version}`.length);
  b.str("A comment").str("TEST").str("Test Track").str("Here");
  if (version >= 7) b.str("OLDLOGO.BMP").str("");
  b.i32(2).i32(10).i32(1).i32(3).i32(511);
  b.blob([0x42, 0x4d, 1, 2]).blob(null).blob(null).blob(null);
  if (version >= 8) b.blob(null).blob([0x41, 0x42]);
  if (version >= 9) b.str("PNG").blob([9, 9, 9]).str("").blob(null);
  if (version >= 10) { b.str("PNG").blob([7, 7]); b.str("").blob(null); b.str("").blob(null); }
  if (version >= 11) b.i32(options.quarters ?? 1);
  b.str("TEST.ACT");
  for (let i = 0; i < 256; i++) b.u8(i).u8(255 - i).u8(i >> 1);
  b.i32(2).str("ART\\GRASS.RAW").i32(6).i32(8).i32(0).str("ART\\ROAD.RAW").i32(0).i32(0).i32(0);
  b.i32(1).str("MODELS\\ROCK.BIN");
  b.i32(boxes.length);
  for (const spec of boxes) box(b, version, spec);
  // The main course, then two extended courses (slots 0 and 1).
  b.i32(1).i32(2000).i32(4000).i32(30).i32(2200).i32(4000).i32(30).i32(40).i32(16).i32(0).i32(0);
  b.i32(2);
  b.i32(1).i32(1).i32(2).i32(3).i32(4).i32(5).i32(6).i32(0).i32(32).i32(0).i32(0);
  b.i32(0);
  terrain(b);
  truck(b, "", 0);
  for (let v = 1; v <= 8; v++) truck(b, "POWERBIG.TRK", 2);
  if (options.arena) {
    b.u8(32).raw("ARENA.BIN").pad(32 - 9 - 8).i16(14).i16(14).i16(100).i16(120);
  } else b.str("BACK.BIN");
  b.i32(2);
  b.i32(1).i32(5).i32(6).i32(1).i32(1).u8(10).u8(20);
  for (let face = 0; face < 6; face++) b.i16(face + 1);
  b.i32(1).str("SOUND\\HIT.WAV").i32(3).i32(1).u8(1).u8(2).u8(3);
  b.i32(1).i32(150).i32(4).i32(0).i32(1).i32(1).i32(0).i32(0).i32(0).i32(0).i32(0);
  b.i32(46333).i32(-46333).i32(0).i32(40960).i32(32000).i32(-46333).i32(0).i32(64000);
  return b.bytes();
}

const ROCK: FixtureBox = { type: 0, model: "ROCK.BIN", sounds: ["NULL.WAV", "HIT.WAV"] };

test("a V2 track reads into Traxx's fields", () => {
  const track = readTxx(fixture(2, [ROCK, { type: 6 }]));
  assert.equal(track.version, 2);
  assert.equal(track.comment, "A comment");
  assert.equal(track.prefix, "TEST");
  assert.equal(track.logoBmpName, "");
  assert.equal(track.trackType, 2);
  assert.equal(track.waterLevel4, 40);
  assert.equal(track.weatherMask, 511);
  assert.deepEqual([...track.logoBmp!], [0x42, 0x4d, 1, 2]);
  assert.equal(track.mapBmp, null);
  assert.equal(track.paletteName, "TEST.ACT");
  assert.equal(track.palette[3 * 10 + 1], 245);
  assert.deepEqual(track.textures[0], { name: "ART\\GRASS.RAW", type: 6, depth: 8 });
  assert.deepEqual(track.models, ["MODELS\\ROCK.BIN"]);
  const [rock] = track.boxes;
  assert.deepEqual(rock.ipos, [1000, 2000, 30]);
  assert.deepEqual(rock.fraction, [4, 8, 64]);
  assert.equal(rock.psi, 0.5);
  assert.equal(rock.mass, 12.5);
  assert.deepEqual(rock.bvel, [1, 2, 3]);
  assert.equal(rock.q, 0.25);
  assert.equal(rock.priority, 1);
  assert.equal(rock.heightAboveGround, 4);
  assert.equal(rock.soundImpact, "HIT.WAV");
  assert.equal(rock.modelName, "ROCK.BIN");
  assert.equal(track.course[0].speedLimit, 40);
  assert.deepEqual(track.course[0].spare, [0, 0]);
  assert.equal(track.extendedCourses[0]?.[0].trackWidth, 32);
  assert.deepEqual(track.extendedCourses[1], []);
  assert.equal(track.extendedCourses[2], null);
  assert.equal(track.heights[0], 120);
  assert.equal(track.heights[300], 100);
  assert.equal(track.clr[256], 0xd005);
  assert.equal(track.clr[257], 3);
  assert.equal(track.lte![0], 237);
  assert.equal(track.trucks[0].name, "");
  assert.equal(track.trucks[8].course, 2);
  assert.equal(track.backdropName, "BACK.BIN");
  assert.equal(track.arena, null);
  assert.equal(track.omitRawFallback, false);
  assert.equal(track.fogMap, null);
  assert.deepEqual(track.groundBoxes[0], { x: 5, y: 6, w: 1, h: 1, lower: 10, upper: 20, faces: [1, 2, 3, 4, 5, 6] });
  assert.deepEqual([...track.sounds[0].data], [1, 2, 3]);
  assert.deepEqual(track.animations[0], { period: 150, nframes: 4, frames: [0, 1, 1, 0, 0, 0, 0, 0] });
  assert.deepEqual(track.sun, { vector: [46333, -46333, 0], shadowIntensity: 40960, position: [32000, -46333, 0], intensity: 64000 });
});

test("writeTxx writes back the same bytes SaveBinary wrote, at every generation a track can need", () => {
  const cases: [number, FixtureBox[], { arena?: boolean; quarters?: number }?][] = [
    [2, [ROCK, { type: 6 }]],
    [3, [ROCK, { type: 12, model: "LAMP.BIN", light: false }]],
    [4, [{ type: 0, sounds: ["AVERYLONGNAME.WAV", "HIT.WAV"] }]],
    [5, [ROCK, { type: 12, light: true }]],
    [7, [ROCK, { type: 98, model: "CPCRUB2.BIN", crush: true }]],
    [8, [ROCK]],
    [9, [ROCK]],
    [10, [ROCK], { arena: true }],
    [11, [ROCK], { quarters: 2 }],
  ];
  for (const [version, boxes, options] of cases) {
    const bytes = fixture(version, boxes, options);
    const track = readTxx(bytes);
    assert.equal(txxVersionFor(track), version, `V${version}`);
    assert.deepEqual(writeTxx(track), bytes, `V${version}`);
  }
});

test("the version is the lowest the track needs, so a plain track stays V2", () => {
  const track: TxxTrack = readTxx(fixture(11, [ROCK]));
  track.waterLevel4 = 40;
  track.uiHd = [null, null, null];
  track.detailMap = null;
  track.maskMap = null;
  track.infoBmp = null;
  track.infoText = null;
  assert.equal(txxVersionFor(track), 7, "the logo name still differs from TESTS.BMP");
  track.logoBmpName = "tests.bmp";
  assert.equal(txxVersionFor(track), 2);
  const v2 = readTxx(writeTxx(track));
  assert.equal(v2.version, 2);
  assert.equal(v2.logoBmpName, "");
});

test("V1 textures carry no type, and a pre-V4 sound name is its fixed 12-byte field", () => {
  const v2 = fixture(2, [ROCK]);
  const v1 = new Bytes();
  // Rebuild the texture table without its V2 fields.
  const text = String.fromCharCode(...v2);
  const at = text.indexOf("\x0eART\\GRASS.RAW");
  const head = [...v2.subarray(0, at)];
  head[6] = "1".charCodeAt(0);
  v1.out.push(...head);
  v1.str("ART\\GRASS.RAW").str("ART\\ROAD.RAW");
  const after = text.indexOf("\x10MODELS\\ROCK.BIN") - 4;
  v1.out.push(...v2.subarray(after));
  const track = readTxx(v1.bytes());
  assert.equal(track.version, 1);
  assert.deepEqual(track.textures.map((t) => [t.name, t.type]), [["ART\\GRASS.RAW", 0], ["ART\\ROAD.RAW", 0]]);
  assert.equal(track.boxes[0].soundImpact, "HIT.WAV");
});

test("an arena backdrop is a 32-byte record with the placement in its tail", () => {
  const track = readTxx(fixture(10, [ROCK], { arena: true }));
  assert.equal(track.backdropName, "ARENA.BIN");
  assert.deepEqual(track.arena, { x: 120, y: 100, sx: 14, sy: 14 });
});

test("what SaveBinary changes: unused sounds go, extended courses close up, a weather mask of 0 means all", () => {
  const track = readTxx(fixture(2, [ROCK]));
  track.boxes[0].soundImpact = "NULL.WAV";
  track.extendedCourses = [null, track.extendedCourses[0], null, null];
  const back = readTxx(writeTxx(track));
  assert.equal(back.sounds.length, 0);
  assert.equal(back.extendedCourses[0]?.length, 1);
  assert.equal(back.extendedCourses[1], null);

  const zeroWeather = fixture(2, [ROCK]);
  // The header, four strings (each a length byte, the text and its NUL), then four ints.
  const at = 10 + 11 + 6 + 12 + 6 + 16;
  assert.equal(new DataView(zeroWeather.buffer).getInt32(at, true), 511);
  new DataView(zeroWeather.buffer).setInt32(at, 0, true);
  assert.equal(readTxx(zeroWeather).weatherMask, 65535);
});

test("a file that is not a .TXX, or ends early, is refused", () => {
  assert.throws(() => readTxx(new TextEncoder().encode("TRAXXV99\0\0rest")), TxxError);
  assert.throws(() => readTxx(new TextEncoder().encode("NOTTRAXX\0\0")), TxxError);
  const bytes = fixture(2, [ROCK]);
  assert.throws(() => readTxx(bytes.subarray(0, bytes.length - 5)), TxxError);
});

/*
  .TXX files Traxx itself saved, when there are any: every one must read and write back byte
  for byte. Looked for in JSTRAXX_TXX, ~/games/traxx and ~/Desktop.
*/
test("Traxx-saved .TXX files read and write back byte for byte", async (t) => {
  const { existsSync, readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const home = process.env.HOME ?? "";
  const dirs = [process.env.JSTRAXX_TXX, join(home, "games", "traxx"), join(home, "Desktop")].filter((d): d is string => Boolean(d) && existsSync(d!));
  const files = dirs.flatMap((d) => readdirSync(d).filter((n) => /\.txx$/i.test(n)).map((n) => join(d, n)));
  if (files.length === 0) { t.skip("no Traxx-saved .TXX files found"); return; }
  for (const file of files) {
    const bytes = new Uint8Array(readFileSync(file));
    const out = writeTxx(readTxx(bytes));
    assert.equal(out.length, bytes.length, file);
    assert.ok(Buffer.from(out).equals(Buffer.from(bytes)), `${file} differs`);
  }
});
