/*
  Traxx 1.8.0's engine sky (engine-sky.ts) and game-library lookup (game-pods.ts), with the
  expectations of Traxx's own tools/skytest.cpp: the handover section 6.4 vectors (exact
  ray-triangle u, v, the closed form, the cap, below the dome, the pinhole pixel vectors), the ring
  rows, the weather -> sky name table and loadSky's fallback, the palette window, the fog fill
  colours, the ball, and the first-match lookup over synthetic PODs (never game art). Then the
  sky's image building (OpenGLSky.cpp SkyBuildDome / SkyBuildBall) over the same synthetic library.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  engineSkyApprox, engineSkyBallFor, engineSkyBallHalfTangent, engineSkyBallScreen, engineSkyBuildBall, engineSkyBuildDome, engineSkyCapCorners,
  engineSkyChoose, engineSkyDomeKey, engineSkyDomeTriangles, engineSkyDomeWorld, engineSkyFogColour, engineSkyGrey, engineSkyHasDome,
  engineSkyHDProbes, engineSkyHDProbesFrom, engineSkyHDSide, engineSkyLevelPalette, engineSkyLookup, engineSkyNote, engineSkyPalette,
  engineSkyPickNames, engineSkyResample, engineSkyResolve, engineSkyTrackNames, engineSkyVertex, engineSunBallDirection, engineDirToTraxxWorld,
  ENGINEWEATHER_CLEAR, ENGINEWEATHER_CLOUDY, ENGINEWEATHER_DENSE_FOG, ENGINEWEATHER_FOGGY, ENGINEWEATHER_NIGHT, ENGINEWEATHER_PITCH_BLACK,
  ENGINEWEATHER_RAIN, ENGINEWEATHER_SNOW, ENGINE_WEATHER_NAMES, type EngineSkyLengthFn, type HdDecode,
} from "../src/core/view/engine-sky.ts";
import { createGamePods, gamePodKey, gamePodsMountList, GAMEPODS_DEFAULT_PODS, GAMEPODS_MAX_MOUNTED } from "../src/core/view/game-pods.ts";
import { createVfs, type Mount } from "../src/core/vfs.ts";
import { normalizePodPath, podPathTitle } from "../src/vendor/openphotex/pod/paths.js";
import type { PodEntry } from "../src/vendor/openphotex/pod/types.js";

const near = (got: number, want: number, tol: number, what: string) => assert.ok(Math.abs(got - want) <= tol, `${what}: got ${got} want ${want}`);
const D2R = (d: number) => (d * Math.PI) / 180;
const dir = (head: number, el: number) => [Math.sin(D2R(head)) * Math.cos(D2R(el)), Math.sin(D2R(el)), Math.cos(D2R(head)) * Math.cos(D2R(el))];

/** sky_port.py cam_dir: pinhole, yaw in the heading convention, pixel (0,0) top-left. */
function camDir(yaw: number, pitch: number, hfov: number, sx: number, sy: number, W: number, H: number): number[] {
  const f = W / 2 / Math.tan(hfov / 2), x = sx + 0.5 - W / 2, y = -(sy + 0.5 - H / 2);
  const fwd = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  let up = [right[1]! * fwd[2]! - right[2]! * fwd[1]!, right[2]! * fwd[0]! - right[0]! * fwd[2]!, right[0]! * fwd[1]! - right[1]! * fwd[0]!];
  if (up[1]! < 0) up = up.map((v) => -v);
  return [0, 1, 2].map((k) => fwd[k]! * f + right[k]! * x + up[k]! * y);
}

test("6.4 vectors: exact ray-triangle u, v and the closed form", () => {
  const t = [
    { name: "+z, level", head: 0, el: 0, u: 0.0, v: 0.98799, au: 0.0, av: 0.98809 },
    { name: "+x, level", head: 90, el: 0, u: 1.0, v: 0.98799, au: 1.0, av: 0.98809 },
    { name: "heading 10, el 0", head: 10, el: 0, u: 0.11142, v: 0.98799, au: 0.11111, av: 0.98809 },
    { name: "heading 45, el 10", head: 45, el: 10, u: 0.5, v: 0.84503, au: 0.5, av: 0.84524 },
    { name: "heading 200, el 30", head: 200, el: 30, u: 2.22389, v: 0.55772, au: 2.22222, av: 0.55556 },
    { name: "heading 300, el 60", head: 300, el: 60, u: 3.35898, v: 0.12311, au: 3.33333, av: 0.11632 },
  ];
  for (const r of t) {
    const d = dir(r.head, r.el);
    const hit = engineSkyLookup(d);
    assert.equal(hit.kind, 1, `${r.name} is dome`);
    near(hit.uv![0], r.u, 6e-6, `${r.name} exact u`);
    near(hit.uv![1], r.v, 6e-6, `${r.name} exact v`);
    const a = engineSkyApprox(d);
    assert.ok(a, `${r.name} approx`);
    near(a[0], r.au, 6e-6, `${r.name} approx u`);
    near(a[1], r.av, 6e-6, `${r.name} approx v`);
  }
  assert.equal(engineSkyLookup([0, 1, 0]).kind, 2, "straight up = cap colour");
  assert.equal(engineSkyLookup(dir(0, -5)).kind, 0, "el -5 = no sky");
  assert.equal(engineSkyApprox(dir(0, -5)), null, "el -5 approx = none");
});

test("6.4 pixel vectors: yaw 30, pitch 5, hfov 90, 1920 x 1080", () => {
  const p = [
    { x: 960, y: 540, kind: 1, u: 0.33704, v: 0.91748 },
    { x: 0, y: 0, kind: 1, u: 3.82138, v: 0.63144 },
    { x: 960, y: 0, kind: 1, u: 0.34692, v: 0.49817 },
    { x: 1919, y: 1079, kind: 0, u: 0, v: 0 },
  ];
  for (const q of p) {
    const hit = engineSkyLookup(camDir(D2R(30), D2R(5), D2R(90), q.x, q.y, 1920, 1080));
    assert.equal(hit.kind, q.kind, `pixel (${q.x},${q.y}) kind`);
    if (q.kind === 1) {
      near(hit.uv![0], q.u, 6e-6, `pixel (${q.x},${q.y}) u`);
      near(hit.uv![1], q.v, 6e-6, `pixel (${q.x},${q.y}) v`);
    }
  }
});

test("ring rows, u, pitches and the cap square", () => {
  const rows = [254.0, 512.0 / 3.0, 256.0 / 3.0, 2.0];
  const elev = (p: number[]) => Math.atan2(p[1]!, Math.sqrt(p[0]! * p[0]! + p[2]! * p[2]!));
  for (let j = 0; j < 4; j++) {
    const { uv } = engineSkyVertex(5, j);
    near(uv[1] * 256.0, rows[j]!, 1e-9, `ring ${j} row`);
    near(uv[0], (5.0 / 16.0) * 4.0, 1e-12, `ring ${j} u at i=5`);
  }
  let v = engineSkyVertex(0, 0);
  near(elev(v.pos), -0.005, 1e-12, "ring 0 pitch -0.005 rad");
  near(v.pos[2], 1024.0 * Math.cos(0.005), 1e-9, "ring 0 i=0 lies on +z");
  v = engineSkyVertex(4, 2);
  near(v.pos[0], 1024.0 * Math.cos(D2R(45)), 1e-9, "i=4 (90 deg) lies on +x");
  near(elev(v.pos), D2R(45), 1e-12, "ring 2 pitch 45");
  v = engineSkyVertex(16, 3);
  near(v.uv[0], 4.0, 1e-12, "i=16 u = 4 (four repeats)");
  near(elev(v.pos), D2R(67.5), 1e-12, "ring 3 pitch 67.5");

  const c = engineSkyCapCorners();
  near(c[0]![0], 1024.0 * Math.sin((3.0 * Math.PI) / 16.0), 1e-9, "cap half size");
  near(c[2]![1], 1024.0, 1e-12, "cap height");
});

/** A tiny in-memory "install" for the name table: only these names exist (and with these lengths). */
const FAKE: [string, string, number][] = [
  ["art", "cloudy2.raw", 65536], ["art", "cloudy2.act", 768],
  ["art", "dusksky.raw", 65536], ["art", "dusksky.act", 768],
  ["art", "cclouds.raw", 65536], ["art", "cclouds.act", 768],
  ["art", "nitesky.raw", 65536], ["art", "nitesky.act", 768],
  ["art", "mysky.raw", 65536], ["art", "mysky.act", 768],
  ["art", "halfsky.raw", 65536], // no .act: falls back
  ["art", "emptysky.raw", 65536], ["art", "emptysky.act", 0], // empty .act: falls back
  ["WeatherArt", "mysky.TGA", 1000],
  ["art", "mysky.PNG", 1000],
];
const fakeLength: EngineSkyLengthFn = (d, n) => FAKE.find(([fd, fn]) => fd.toLowerCase() === d.toLowerCase() && fn.toLowerCase() === n.toLowerCase())?.[2] ?? -1;

test("the weather -> sky name table, the dome flag, Cloudy greying and levelType 4", () => {
  assert.equal(ENGINE_WEATHER_NAMES.length, 9);
  assert.deepEqual([ENGINEWEATHER_CLEAR, ENGINEWEATHER_CLOUDY, ENGINEWEATHER_FOGGY, ENGINEWEATHER_DENSE_FOG, ENGINEWEATHER_RAIN, ENGINEWEATHER_SNOW, ENGINEWEATHER_NIGHT, ENGINEWEATHER_PITCH_BLACK], [0, 1, 2, 3, 4, 5, 7, 8]);
  const want = ["mysky.raw", "mysky.raw", "mysky.raw", "mysky.raw", "cclouds.raw", "mysky.raw", "dusksky.raw", "nitesky.raw", "mysky.raw"];
  const dome = [true, true, false, false, true, false, true, true, false];
  for (let w = 0; w < 9; w++) {
    let c = engineSkyResolve(w, false, "mysky.raw", "mysky.act", fakeLength);
    assert.equal(c.raw, want[w], `weather ${w} -> ${want[w]}`);
    assert.ok(c.act.startsWith(c.raw.slice(0, c.raw.length - 3)), `weather ${w} .act follows .raw`);
    assert.equal(engineSkyHasDome(w), dome[w], `weather ${w} dome flag`);
    assert.equal(c.greyscale, w === ENGINEWEATHER_CLOUDY, `weather ${w} greyscale only in Cloudy`);
    assert.equal(c.fellback, false, "named sky present: no fallback");
    // An original MTM level always gets cloudy2, except where the weather overrides it.
    c = engineSkyResolve(w, true, "mysky.raw", "mysky.act", fakeLength);
    assert.equal(c.raw, w === 4 || w === 6 || w === 7 ? want[w] : "cloudy2.raw", `levelType 4, weather ${w}`);
  }
});

test("loadSky's fallback, the %39s cut and the HD probes", () => {
  let c = engineSkyResolve(ENGINEWEATHER_CLEAR, false, "halfsky.raw", "halfsky.act", fakeLength);
  assert.ok(c.raw === "cloudy2.raw" && c.act === "cloudy2.act" && c.fellback, "missing .act -> cloudy2");
  c = engineSkyResolve(ENGINEWEATHER_CLEAR, false, "emptysky.raw", "emptysky.act", fakeLength);
  assert.ok(c.raw === "cloudy2.raw" && c.fellback, "empty .act -> cloudy2");
  c = engineSkyResolve(ENGINEWEATHER_CLEAR, false, "nosuch.raw", "nosuch.act", fakeLength);
  assert.ok(c.raw === "cloudy2.raw" && c.fellback, "missing pair -> cloudy2");
  c = engineSkyResolve(ENGINEWEATHER_CLEAR, false, "  0123456789012345678901234567890123456789extra  ", "x.act", fakeLength);
  assert.equal(c.fellback, true, "an over-long name is cut to 39 and then not found");
  const p = engineSkyPickNames(ENGINEWEATHER_CLEAR, false, "0123456789012345678901234567890123456789extra", "a b");
  assert.equal(p.raw.length, 39, "%39s cuts the .LVL name to 39 characters");
  assert.equal(p.act, "a", "%39s stops at whitespace");
  // No length function at all: cloudy2 (Traxx's len == NULL).
  assert.equal(engineSkyResolve(ENGINEWEATHER_CLEAR, false, "mysky.raw", "mysky.act", null).raw, "cloudy2.raw");

  // HD probes: PNG then TGA, WeatherArt wins per candidate only where the candidate is there.
  const pr = engineSkyHDProbes("mysky.raw", fakeLength);
  assert.equal(pr.length, 2, "two HD probes");
  assert.deepEqual([pr[0]!.dir, pr[0]!.name], ["art", "mysky.PNG"], "probe 1 = art\\mysky.PNG");
  assert.deepEqual([pr[1]!.dir, pr[1]!.name], ["WeatherArt", "mysky.TGA"], "probe 2 = WeatherArt\\mysky.TGA");
  const ne = engineSkyHDProbes("noext", fakeLength);
  assert.ok(ne.length === 2 && ne[0]!.name === "noext.PNG" && ne[1]!.name === "noext.TGA", "no extension: one appended (artSwapExt)");
  const dd = engineSkyHDProbes("a.b.raw", fakeLength);
  assert.ok(dd.length === 2 && dd[0]!.name === "a.b.PNG", "the LAST dot's extension is swapped");
  assert.equal(engineSkyHDProbes("", fakeLength).length, 0, "empty name, no probe");

  // The names Traxx's Write POD puts in the .LVL.
  assert.deepEqual(engineSkyTrackNames(true), { raw: "cloudy2.raw", act: "cloudy2.act", levelType4: false });
  assert.deepEqual(engineSkyTrackNames(false), { raw: "aliensky.raw", act: "earthsky.act", levelType4: true });
});

test("fog fill colours and the balls", () => {
  assert.deepEqual(engineSkyFogColour(ENGINEWEATHER_SNOW), [192, 192, 192], "Snow fill 192");
  const fog = engineSkyFogColour(ENGINEWEATHER_FOGGY);
  assert.ok(fog[0] === 140 && fog[2] === 140, "Foggy fill 140");
  const dense = engineSkyFogColour(ENGINEWEATHER_DENSE_FOG);
  assert.ok(dense[0] === 139 && dense[2] === 139, "Dense fog fill 139");
  assert.deepEqual(engineSkyFogColour(ENGINEWEATHER_PITCH_BLACK), [0, 0, 0], "Pitch black fill black");
  assert.deepEqual(engineSkyFogColour(ENGINEWEATHER_CLEAR), [150, 170, 200], "Clear fog 150,170,200");

  const sun = engineSkyBallFor(ENGINEWEATHER_CLEAR)!;
  assert.ok(sun.kind === 1 && sun.raw === "suncram.raw" && sun.radius === 0.5 && sun.tex[2] === 124, "Clear: the sun");
  const moon = engineSkyBallFor(ENGINEWEATHER_NIGHT)!;
  assert.ok(moon.kind === 2 && moon.raw === "moon.raw" && moon.radius === 0.07 && moon.tex[2] === 248, "Night: the moon");
  for (let w = 0; w < 9; w++) if (w !== ENGINEWEATHER_CLEAR && w !== ENGINEWEATHER_NIGHT) assert.equal(engineSkyBallFor(w), null, "no ball outside Clear / Night");
  near(engineSkyBallHalfTangent(0.5, 4.0 / 3.0), (((0.5 * 66536.0) / 65536.0) * 4.0) / 3.0, 1e-12, "ball half tangent");
});

test("the ball's direction and the engine -> world mapping (EngineLight.cpp, lighttest's checks)", () => {
  // y halved, normalised, negated; no horizon test.
  const d = engineSunBallDirection([-46333, -46333, 0])!;
  near(Math.atan2(d[1], Math.hypot(d[0], d[2])), Math.atan(0.5), 1e-12, "45 degrees drawn at atan(1/2)");
  assert.ok(d[0] > 0 && d[2] === 0, "same azimuth as the sun");
  const below = engineSunBallDirection([0, 46333, 46333])!;
  assert.ok(below[1] < 0, "a sun below the horizon still has a ball direction");
  assert.equal(engineSunBallDirection([0, 0, 0]), null, "zero vector: none");
  assert.deepEqual(engineDirToTraxxWorld([1, 2, 3]), [128, 384, 192], "(x, z, y) at 128 / 128 / 96");
  const w = engineDirToTraxxWorld([Math.SQRT1_2, Math.SQRT1_2, 0]);
  near(Math.atan2(w[2], Math.hypot(w[0], w[1])), Math.atan(96 / 128), 1e-12, "45 degrees lands at atan(96/128) in world units");
});

test("the dome buffers: 96 triangles, the APImode split, world axes", () => {
  const t = engineSkyDomeTriangles();
  assert.equal(t.count, 288);
  // Quad (0, 0): v1 (0,0) v2 (0,1) v3 (1,1) | v1 v3 v4 (1,0).
  const v = (i: number, j: number) => engineSkyVertex(i, j);
  const at = (k: number) => [t.positions[k * 3]!, t.positions[k * 3 + 1]!, t.positions[k * 3 + 2]!];
  assert.deepEqual(at(0), v(0, 0).pos);
  assert.deepEqual(at(1), v(0, 1).pos);
  assert.deepEqual(at(2), v(1, 1).pos);
  assert.deepEqual(at(3), v(0, 0).pos);
  assert.deepEqual(at(5), v(1, 0).pos);
  assert.equal(t.uvs[287 * 2], v(16, 0).uv[0], "the last vertex is the seam, u = 4");
  const wbuf = engineSkyDomeWorld(1 / 32);
  assert.equal(wbuf.positions.length, 288 * 3);
  near(wbuf.cap[2]!, (1024 * 96) / 32, 1e-3, "cap height in world z");
  near(wbuf.positions[2]!, Math.fround((Math.sin(-0.005) * 1024 * 96) / 32), 1e-3, "first vertex z (just below the horizon)");
});

test("the ball's screen square", () => {
  const sun = engineSkyBallFor(ENGINEWEATHER_CLEAR)!;
  const s = engineSkyBallScreen(sun, 128, [0, 0, -1], 500, 800, 600)!;
  assert.deepEqual([s.sx, s.sy], [400, 300], "straight ahead: the centre");
  near(s.r, engineSkyBallHalfTangent(0.5, 800 / 600) * 500, 1e-9, "half size = half tangent x focal");
  assert.deepEqual([s.u1, s.v1, s.u2, s.v2], [4 / 128, 4 / 128, 124 / 128, 124 / 128]);
  assert.equal(engineSkyBallScreen(sun, 128, [0, 0, 1], 500, 800, 600), null, "behind the eye");
  assert.ok(engineSkyBallScreen(sun, 128, [0, -0.5, -1], 500, 800, 600)!.sy > 300, "below the view axis is drawn, lower on screen");
});

test("the palette window, a short .ACT, Cloudy grey and the HD side", () => {
  const level = new Uint8Array(768), act = new Uint8Array(768);
  for (let i = 0; i < 768; i++) {
    level[i] = (i * 7) & 255;
    act[i] = 255 - (i % 256);
  }
  let out = engineSkyPalette(level, act, false);
  assert.deepEqual(out.subarray(230 * 3, 246 * 3), act.subarray(192 * 3, 208 * 3), "slots 230..245 = act 192..207");
  for (let i = 0; i < 256; i++) if (i < 230 || i > 245) assert.deepEqual(out.subarray(i * 3, i * 3 + 3), level.subarray(i * 3, i * 3 + 3), "other slots keep the level palette");
  for (let i = 230; i <= 245; i++) assert.deepEqual(out.subarray(i * 3, i * 3 + 3), act.subarray((i - 38) * 3, (i - 38) * 3 + 3), "index i in 230..245 has colour act[i - 38]");

  // A short .ACT fills only what it has (fread of a short file).
  out = engineSkyPalette(level, act.subarray(0, 192 * 3 + 6), false);
  assert.ok(out.subarray(230 * 3, 232 * 3).every((b, k) => b === act[192 * 3 + k]) && out.subarray(232 * 3, 246 * 3).every((b, k) => b === level[232 * 3 + k]), "short .ACT: two entries, the rest the level's");
  assert.deepEqual(engineSkyPalette(level, null, false), level, "no .ACT: the level palette");

  // Cloudy grey, in the engine's floats and truncation.
  const g = [255, 255, 255];
  engineSkyGrey(g);
  assert.equal(g[0], 254, "grey(255,255,255) = 254");
  const g2 = [100, 150, 200];
  engineSkyGrey(g2);
  assert.deepEqual(g2, [155, 155, 155], "grey(100,150,200) = 155");
  out = engineSkyPalette(level, act, true);
  for (let i = 230; i <= 245; i++) {
    const c = [act[(i - 38) * 3]!, act[(i - 38) * 3 + 1]!, act[(i - 38) * 3 + 2]!];
    engineSkyGrey(c);
    assert.ok(out[i * 3] === c[0] && out[i * 3 + 1] === c[0] && out[i * 3 + 2] === c[0], "Cloudy greys the window");
  }
  assert.deepEqual(out.subarray(0, 230 * 3), level.subarray(0, 230 * 3), "Cloudy leaves the rest alone");

  assert.equal(engineSkyHDSide(512, 512), 512, "HD 512 square kept");
  assert.equal(engineSkyHDSide(4096, 4096), 2048, "HD 4096 capped 2048");
  assert.equal(engineSkyHDSide(1000, 600), 512, "HD 1000x600 -> 512");
  // The resample: a 2 x 2 down to 1 averages, a same-size copy is exact.
  const px = Uint8Array.from([0, 0, 0, 255, 100, 0, 0, 255, 0, 200, 0, 255, 0, 0, 40, 255]);
  assert.deepEqual([...engineSkyResample(px, 2, 2, 1)], [25, 50, 10, 255]);
  assert.deepEqual([...engineSkyResample(px, 2, 2, 2)], [...px]);
});

// ---- the game library: synthetic mounts (no game art) ----

const bytes = (s: string) => new TextEncoder().encode(s);
const str = (b: Uint8Array | null) => (b === null ? null : new TextDecoder().decode(b));

/** A mount holding exactly these entries in this order (duplicates and 32-character names allowed, as a hand-packed POD can have them). */
function mount(name: string, files: [string, string | Uint8Array][]): Mount {
  const data: Uint8Array[] = [];
  const entries: PodEntry[] = files.map(([n, d], index) => {
    const b = typeof d === "string" ? bytes(d) : d;
    data.push(b);
    return { index, name: n, normalizedName: normalizePodPath(n), title: podPathTitle(n), length: b.length, offset: index, recordOffset: 0, paletteName: null, timestamp: null, crc: null };
  });
  return {
    name,
    archive: { format: "pod1", comment: name, entries, byteLength: 0, directoryOffset: 4, directoryEnd: 0, checksum: null, auditCount: null },
    readEntry: async (e) => data[e.index]!.slice(),
  };
}

const A = mount("A.POD", [
  ["ART\\CLOUDY2.RAW", "A0"], ["ART\\CLOUDY2.RAW", "A1"], ["art\\lower.act", "low"],
  ["ART\\ABCDEFGHIJKLMNOPQRSTUVWXYZ0", "long31"], // 4 + 27 = 31 characters
  ["ART\\ZERO.ACT", ""],
]);
const B = mount("B.POD", [
  ["ART\\CLOUDY2.RAW", "B"], ["ART\\CLOUDY2.ACT", "Bact"], ["ART\\ONLYB.RAW", "onlyb"],
  ["ART\\ABCDEFGHIJKLMNOPQRSTUVWXYZ01", "long32"], // 32: never findable
  ["WeatherArt\\cloudy2.PNG", "png"],
]);

test("pod.ini: the mount list, the count, the defaults and the engine's limit", () => {
  const none = gamePodsMountList(null);
  assert.deepEqual(none.names, [...GAMEPODS_DEFAULT_PODS], "no pod.ini: the engine's four defaults");
  assert.equal(none.names[0], "system\\startup.pod", "system\\startup.pod first");
  assert.equal(none.haveIni, false);
  const ini = gamePodsMountList("4\na.pod\nmissing.pod\nbad.pod  b.pod\n");
  assert.ok(ini.haveIni, "pod.ini read");
  assert.deepEqual(ini.names, ["a.pod", "missing.pod", "bad.pod", "b.pod"], "whitespace-separated, in file order");
  assert.deepEqual(gamePodsMountList("1\nb.pod\na.pod\n").names, ["b.pod"], "the count limits the list");
  assert.deepEqual(gamePodsMountList("3\nb.pod\n").names, ["b.pod"], "a short list stops where the names run out");
  assert.deepEqual(gamePodsMountList("junk\nb.pod\n").names, [], "an unreadable count mounts nothing");
  const long = gamePodsMountList(`501\n${Array.from({ length: 501 }, (_, i) => `p${i}.pod`).join("\n")}`);
  assert.equal(long.names.length, GAMEPODS_MAX_MOUNTED, "499 can mount");
  assert.equal(long.overLimit, 2, "the rest are over the engine's limit");
  assert.equal(gamePodsMountList(`1\n${"x".repeat(100)}`).names[0]!.length, 79, "%79s");
});

test("the key: upper-cased, dir prefixed, the dosFileLength backslash rule, 32 characters never match", () => {
  assert.equal(gamePodKey("art", "cloudy2.raw", false), "ART\\CLOUDY2.RAW");
  assert.equal(gamePodKey("", "art\\cloudy2.raw", true), "ART\\CLOUDY2.RAW");
  assert.equal(gamePodKey("art", "x\\y.raw", true), "X\\Y.RAW", "dosFileLength takes a name holding a backslash whole");
  assert.equal(gamePodKey("art", "x\\y.raw", false), "ART\\X\\Y.RAW", "dopen always prefixes the directory");
  assert.equal(gamePodKey("art", "", false), null);
  assert.equal(gamePodKey("art", "ABCDEFGHIJKLMNOPQRSTUVWXYZ01", false), null, "a 32-character key");
  assert.equal(gamePodKey("art", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0", false), "ART\\ABCDEFGHIJKLMNOPQRSTUVWXYZ0");
});

test("the lookup: mount order, lowest index, pods in the user's order, lengths, the cache", async () => {
  let vfs = createVfs([A, B]);
  let reads = 0;
  const pods = createGamePods((p) => {
    reads++;
    return vfs.read(p);
  }, () => vfs.mounts.length > 0);

  assert.equal(str(await pods.read("art", "cloudy2.raw")), "A0", "first pod, lowest index wins");
  assert.equal(str(await pods.read("ART", "CLOUDY2.ACT")), "Bact", "next pod when the first lacks it");
  assert.equal(str(await pods.read("art", "lower.act")), "low", "a lowercase entry name matches upper-cased");
  assert.equal(str(await pods.read("art", "onlyb.raw")), "onlyb", "in a later pod");
  assert.equal(await pods.read("art", "nothing.raw"), null, "nowhere");
  assert.equal(str(await pods.read("art", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0")), "long31", "31-character name found");
  assert.ok((await pods.length("art", "ABCDEFGHIJKLMNOPQRSTUVWXYZ01")) < 0, "32-character name never matches");
  assert.equal(await pods.length("art", "cloudy2.raw"), 2, "length from the winning entry");
  assert.equal(await pods.length("art", "zero.act"), 0, "zero-length entry answers 0");
  assert.equal(await pods.length("", "art\\cloudy2.raw"), 2, "name with a backslash, no dir");
  assert.equal(await pods.length("WeatherArt", "cloudy2.png"), 3, "WeatherArt");
  assert.ok(pods.mounted);

  // The cache: asked once a generation.
  const before = reads;
  await pods.read("art", "cloudy2.raw");
  await pods.length("art", "cloudy2.raw");
  assert.equal(reads, before, "answered from the cache");

  // The engine's loadSky over these pods: a zero-length .ACT falls back.
  const c = await engineSkyChoose(pods, ENGINEWEATHER_CLEAR, false, "cloudy2.raw", "zero.act");
  assert.ok(c.fellback && c.raw === "cloudy2.raw", "zero-length .act in a pod -> cloudy2");
  const pr = await engineSkyHDProbesFrom(pods, c.raw);
  assert.equal(pr.length, 2, "probes");
  assert.equal(pr[0]!.dir, "WeatherArt", "WeatherArt\\cloudy2.PNG wins its candidate");
  assert.equal(pr[1]!.dir, "art", "no WeatherArt TGA -> art");

  // Reverse the order: B now wins, once the cache is told.
  vfs = createVfs([B, A]);
  const gen = pods.generation;
  assert.equal(str(await pods.read("art", "cloudy2.raw")), "A0", "cached until invalidated");
  pods.invalidate();
  assert.notEqual(pods.generation, gen, "generation moved");
  assert.equal(str(await pods.read("art", "cloudy2.raw")), "B", "mount order follows the library");

  // No PODs: everything misses.
  vfs = createVfs([]);
  pods.invalidate();
  assert.ok((await pods.length("art", "cloudy2.raw")) < 0, "no library, no art");
  assert.equal(pods.mounted, false);
});

// ---- building the images (OpenGLSky.cpp), synthetic art ----

function rampPalette(): Uint8Array {
  const p = new Uint8Array(768);
  for (let i = 0; i < 256; i++) p.set([i, 255 - i, (i * 3) & 255], i * 3);
  return p;
}

test("the legacy dome: the .RAW through the sky palette, the cap, a 64 page, Cloudy", async () => {
  const raw = new Uint8Array(65536);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 13) & 255;
  raw[0] = 231;
  const act = new Uint8Array(768).fill(7);
  for (let i = 192; i < 208; i++) act.set([i, 10, 20], i * 3);
  const small = new Uint8Array(4096).fill(5);
  const pods = createGamePods(createVfs([mount("SKY.POD", [["ART\\MYSKY.RAW", raw], ["ART\\MYSKY.ACT", act], ["ART\\SMALL.RAW", small], ["ART\\SHORT.RAW", Uint8Array.of(9, 9, 9)]])]).read);
  const level = rampPalette();

  const choice = { raw: "mysky.raw", act: "mysky.act", fellback: false, greyscale: false };
  const dome = await engineSkyBuildDome(pods, choice, level, null);
  assert.ok(typeof dome !== "string");
  assert.equal(dome.side, 256);
  assert.equal(dome.hd, false);
  const pal = engineSkyPalette(level, act, false);
  for (const k of [1, 2, 300, 65535]) {
    const ix = raw[k]!;
    assert.deepEqual([...dome.rgba.subarray(k * 4, k * 4 + 4)], [pal[ix * 3], pal[ix * 3 + 1], pal[ix * 3 + 2], 255], `texel ${k}`);
  }
  assert.deepEqual(dome.cap, [231 - 38, 10, 20], "cap = the top-left texel through the window (index 231 -> act 193)");

  const small64 = await engineSkyBuildDome(pods, { ...choice, raw: "small.raw" }, level, null);
  assert.ok(typeof small64 !== "string" && small64.side === 64, "a 4096-byte file is a 64 page");
  const short = await engineSkyBuildDome(pods, { ...choice, raw: "short.raw" }, level, null);
  assert.ok(typeof short !== "string" && short.side === 256 && short.rgba[3 * 4] === pal[0] && short.rgba[3 * 4 + 3] === 255, "a short file: index 0 past its end, opaque");
  assert.match(String(await engineSkyBuildDome(pods, { ...choice, raw: "gone.raw" }, level, null)), /could not be read/);

  const grey = await engineSkyBuildDome(pods, { ...choice, greyscale: true }, level, null);
  assert.ok(typeof grey !== "string");
  const c = [act[193 * 3]!, act[193 * 3 + 1]!, act[193 * 3 + 2]!];
  engineSkyGrey(c);
  assert.deepEqual(grey.cap, [c[0], c[0], c[0]], "Cloudy: the window greyed, so the cap too");

  // The dome's cache key moves with the generation, the names, the grey flag and the palette.
  const k1 = engineSkyDomeKey(1, choice, level);
  assert.notEqual(k1, engineSkyDomeKey(2, choice, level));
  assert.notEqual(k1, engineSkyDomeKey(1, { ...choice, greyscale: true }, level));
  assert.notEqual(k1, engineSkyDomeKey(1, choice, new Uint8Array(768)));
});

test("an HD dome: the first probe with a real header wins; a decode failure means the legacy art", async () => {
  const raw = new Uint8Array(65536).fill(1);
  // A PNG signature and IHDR claiming 4 x 2.
  const png = new Uint8Array(40);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 4, 0, 0, 0, 2]);
  const notimage = bytes("this is a renamed text file, not a png at all");
  const lib = createVfs([mount("HD.POD", [["ART\\HDSKY.RAW", raw], ["ART\\HDSKY.ACT", new Uint8Array(768)], ["WeatherArt\\HDSKY.PNG", png], ["ART\\HDSKY.TGA", notimage], ["ART\\BADSKY.RAW", raw], ["ART\\BADSKY.PNG", notimage]])]);
  const pods = createGamePods(lib.read);
  const asked: string[] = [];
  const decode: HdDecode = async (_b, ext, name) => {
    asked.push(`${ext}:${name}`);
    const rgba = new Uint8Array(4 * 2 * 4);
    for (let i = 0; i < 8; i++) rgba.set([200, 100, 50, 7], i * 4);
    return { width: 4, height: 2, rgba };
  };
  const dome = await engineSkyBuildDome(pods, { raw: "hdsky.raw", act: "hdsky.act", fellback: false, greyscale: false }, rampPalette(), decode);
  assert.ok(typeof dome !== "string");
  assert.equal(dome.hd, true);
  assert.equal(dome.side, 4, "4 x 2 -> the largest power of two not above 4");
  assert.deepEqual([...dome.rgba.subarray(0, 4)], [200, 100, 50, 255], "opaque");
  assert.deepEqual(dome.cap, [200, 100, 50], "cap = the top-left block's average");
  assert.deepEqual(asked, ["PNG:hdsky.PNG"], "the PNG probe answered: the TGA is never asked");

  // A .PNG that is not a PNG moves on; no TGA anywhere: the legacy page.
  const legacy = await engineSkyBuildDome(pods, { raw: "badsky.raw", act: "hdsky.act", fellback: false, greyscale: false }, rampPalette(), decode);
  assert.ok(typeof legacy !== "string" && legacy.hd === false && legacy.side === 256);
  // A header that reads but a decode that fails: the legacy art, no further probe.
  const failing: HdDecode = async () => null;
  const after = await engineSkyBuildDome(pods, { raw: "hdsky.raw", act: "hdsky.act", fellback: false, greyscale: false }, rampPalette(), failing);
  assert.ok(typeof after !== "string" && after.hd === false);
});

test("the balls: own .ACT, else DEFAULT.ACT; the side from the length; the level palette for levelType 4", async () => {
  const sunRaw = new Uint8Array(128 * 128).fill(3);
  const moonRaw = new Uint8Array(256 * 256).fill(4);
  const sunAct = new Uint8Array(768); sunAct.set([250, 240, 230], 9);
  const def = new Uint8Array(768); def.set([1, 2, 3], 12);
  const old = new Uint8Array(768).fill(66);
  const pods = createGamePods(createVfs([mount("BALL.POD", [["ART\\SUNCRAM.RAW", sunRaw], ["ART\\SUNCRAM.ACT", sunAct], ["ART\\MOON.RAW", moonRaw], ["ART\\DEFAULT.ACT", def], ["ART\\OLDMTM.ACT", old]])]).read);

  const sun = await engineSkyBuildBall(pods, engineSkyBallFor(ENGINEWEATHER_CLEAR)!, null);
  assert.ok(sun);
  assert.equal(sun.side, 128);
  assert.equal(sun.texSide, 128);
  assert.deepEqual([...sun.rgba.subarray(0, 4)], [250, 240, 230, 255], "its own .ACT");
  const moon = await engineSkyBuildBall(pods, engineSkyBallFor(ENGINEWEATHER_NIGHT)!, null);
  assert.ok(moon && moon.side === 256);
  assert.deepEqual([...moon.rgba.subarray(0, 4)], [1, 2, 3, 255], "no MOON.ACT: DEFAULT.ACT");

  const track = rampPalette();
  assert.deepEqual(await engineSkyLevelPalette(pods, true, track), old, "levelType 4: oldmtm.act");
  assert.deepEqual(await engineSkyLevelPalette(pods, false, track), track, "else the track's palette");
});

test("the status note", () => {
  const choice = { raw: "cloudy2.raw", act: "cloudy2.act", fellback: false, greyscale: false };
  assert.match(engineSkyNote(false, choice, 65536, 0, false, "mysky.raw", "mysky.act"), /no game PODs/);
  assert.match(engineSkyNote(true, choice, -1, 0, false, "mysky.raw", "mysky.act"), /ART\\cloudy2\.raw is not/);
  assert.match(engineSkyNote(true, { ...choice, fellback: true }, 65536, 0, false, "mysky.raw", "mysky.act"), /ART\\mysky\.raw or ART\\mysky\.act is missing/);
  assert.equal(engineSkyNote(true, choice, 65536, 0, false, "cloudy2.raw", "cloudy2.act"), "");
});
