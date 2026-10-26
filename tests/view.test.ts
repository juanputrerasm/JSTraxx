import test from "node:test";
import assert from "node:assert/strict";
import { TraxxCamera, MAX_Z_POSITION } from "../src/core/view/camera.ts";
import { cornerUv, buildTileSet, gammaMap, legacyTileRgba } from "../src/core/view/tiles.ts";
import { newTrackDocument } from "../src/core/doc/new-track.ts";
import { withSysColors } from "../src/core/traxx/palette.ts";

const flat = () => 50;

test("the camera starts where Traxx's does and climbs 100 steps above the ground on open", () => {
  const cam = new TraxxCamera();
  assert.deepEqual([cam.x, cam.y, cam.gridx, cam.gridy, cam.orientation, cam.elevation], [8192, 8192, 128, 128, 0, 900]);
  assert.equal(cam.z, MAX_Z_POSITION / 2);
  cam.resetForTrack(flat);
  assert.equal(cam.z, 3 * 150);
});

test("Up moves along the facing; Right turns clockwise; speeds build up over ticks", () => {
  const cam = new TraxxCamera();
  cam.keys.up = true;
  cam.tick(55, flat);
  assert.equal(cam.x, 8192);
  assert.ok(cam.y > 8192, "north at orientation 0");
  const y1 = cam.y;
  cam.tick(55, flat);
  assert.ok(cam.y - y1 > y1 - 8192, "accelerating");
  cam.release("up");
  cam.keys.right = true;
  for (let i = 0; i < 20; i++) cam.tick(55, flat);
  assert.ok(cam.orientation > 0 && cam.orientation < 1800);
  cam.release("right");
  cam.setOrientation(900);
  assert.deepEqual(cam.dvector, [256, 0], "east");
  const x0 = cam.x;
  cam.keys.up = true;
  cam.tick(55, flat);
  assert.ok(cam.x > x0, "facing east, Up goes east");
});

test("strafe goes right of the facing; A climbs; positions clamp", () => {
  const cam = new TraxxCamera();
  cam.keys.strafeRight = true;
  cam.tick(55, flat); cam.tick(55, flat);
  assert.ok(cam.x > 8192 && cam.y === 8192);
  cam.stop();
  cam.z = MAX_Z_POSITION - 1;
  cam.keys.a = true;
  for (let i = 0; i < 10; i++) cam.tick(55, flat);
  assert.equal(cam.z, MAX_Z_POSITION);
  cam.stop();
  cam.keys.pgDown = true;
  for (let i = 0; i < 100; i++) cam.tick(55, flat);
  assert.equal(cam.elevation, 1800, "PgDn pitches down to straight down");
});

test("F4 keeps the height above the ground while moving", () => {
  const cam = new TraxxCamera();
  const slope = (x: number) => x >> 6;
  cam.z = 3 * (slope(cam.x) + 40);
  cam.lockZ = true;
  cam.setOrientation(900);
  cam.keys.up = true;
  for (let i = 0; i < 10; i++) cam.tick(55, slope);
  assert.equal(cam.z, 3 * 40 + 3 * slope(cam.x));
});

test("F2 saves the place and F3 returns to it; a map click jumps to an even cell", () => {
  const cam = new TraxxCamera();
  assert.equal(cam.restoreLocation(), false);
  cam.saveLocation();
  cam.x = 100; cam.y = 200; cam.setOrientation(450);
  assert.equal(cam.restoreLocation(), true);
  assert.deepEqual([cam.x, cam.y, cam.orientation], [8192, 8192, 0]);
  cam.mapClick(0.5, 0.25);
  assert.equal(cam.gridx, 126);
  assert.equal(cam.gridy, 192);
  assert.equal(cam.x, 126 << 6);
  assert.deepEqual(cam.indicators(), { x: "X: 126", y: "Y: 192", z: `Z: ${Math.trunc(cam.z / 3)}` });
});

test("TextureAlignment: corners, mirrors and rotations", () => {
  // Unrotated: v00 samples the bottom-left texel, v11 the top-right, inset 2.
  assert.deepEqual(cornerUv(0, 0, 64), [2 / 64, 62 / 64]);
  assert.deepEqual(cornerUv(2, 0, 64), [62 / 64, 2 / 64]);
  assert.deepEqual(cornerUv(0, 0, 256), [2 / 256, 253 / 256]);
  // Rotation 1 (bit 14) moves each corner one step on.
  assert.deepEqual(cornerUv(0, 0x4000, 64), cornerUv(1, 0, 64));
  // Mirror bit 12: corner b becomes 3 - b.
  assert.deepEqual(cornerUv(0, 0x1000, 64), cornerUv(3, 0, 64));
  // Mirror bit 13: corner b becomes 1 - b.
  assert.deepEqual(cornerUv(0, 0x2000, 64), cornerUv(1, 0, 64));
  // The texture index bits do not matter.
  assert.deepEqual(cornerUv(2, 0x0abc, 64), cornerUv(2, 0, 64));
});

test("tiles are remapped into the track palette, with the gamma on the palette", () => {
  const doc = newTrackDocument();
  const pal = new Uint8Array(768);
  pal.set([100, 0, 0], 3);
  doc.track.palette = withSysColors(pal);
  const act = new Uint8Array(768);
  act.set([98, 2, 1], 5 * 3); // nearest track colour: entry 1
  doc.textures = [
    { name: "ART\\A.RAW", side: 64, indices: new Uint8Array(4096).fill(5), act, hd: null, bad: false },
    null,
    { name: "ART\\B.RAW", side: 256, indices: new Uint8Array(65536), act: null, hd: null, bad: false },
  ];
  const set = buildTileSet(doc, 1);
  assert.deepEqual([...set.small.rgba.subarray(0, 4)], [100, 0, 0, 255]);
  assert.equal(set.where[0], 0);
  assert.equal(set.where[1], -1);
  assert.equal(set.where[2], (1 << 15) | 0);
  assert.deepEqual([set.side[0], set.side[2]], [64, 256]);
  const bright = legacyTileRgba(doc.textures[0]!, doc.track.palette, gammaMap(2));
  assert.equal(bright!.rgba[0], Math.trunc(255 * Math.sqrt(100 / 255)));
  const hd = buildTileSet(doc, 2, new Map([[0, { width: 128, height: 128, rgba: new Uint8Array(128 * 128 * 4).fill(7) }]]));
  assert.equal(hd.where[0] >> 15, 1, "an HD image over 64 goes to the large array");
  assert.equal(hd.large.rgba[0], 7, "HD art takes no gamma");
});

test("objects turn clockwise by psi, squash by 768/1024 and sit at ipos + fraction / 256", async () => {
  const { objectMatrix } = await import("../src/core/view/model-geometry.ts");
  const apply = (m: number[], v: [number, number, number]) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);
  const box = { ipos: [100, 200, 10] as [number, number, number], fraction: [128, 0, 64] as [number, number, number], theta: 0, phi: 0, psi: Math.PI / 2 };
  const [x, y, z] = apply(objectMatrix(box), [0, 1, 0]);
  assert.ok(Math.abs(x - 101.5) < 1e-9 && Math.abs(y - 200) < 1e-9, `north turns to east: ${x}, ${y}`);
  assert.ok(Math.abs(z - 3 * 10.25) < 1e-9);
  const up = apply(objectMatrix({ ...box, psi: 0 }), [0, 0, 4]);
  assert.ok(Math.abs(up[2] - (3 * 10.25 + 3)) < 1e-9, "4 up becomes 3 after the squash");
});

test("ground boxes hide the sides their neighbours cover and a bottom on the ground", async () => {
  const { groundBoxGeometry } = await import("../src/core/view/ground-box-geometry.ts");
  const faces = [0, 0, 0, 0, 0, 0];
  const lone = groundBoxGeometry([{ x: 10, y: 10, w: 1, h: 1, lower: 0, upper: 20, faces }], null);
  // Four sides and the top, two triangles each; no bottom at height 0.
  assert.deepEqual([...new Set([...lone.faceOf].map((f) => f % 8))].sort(), [0, 1, 2, 3, 4]);
  assert.equal(lone.positions.length / 9, 10);
  const pair = groundBoxGeometry([
    { x: 10, y: 10, w: 1, h: 1, lower: 5, upper: 20, faces },
    { x: 11, y: 10, w: 1, h: 1, lower: 0, upper: 30, faces },
  ], null);
  const first = [...pair.faceOf].filter((f) => f >> 3 === 0).map((f) => f % 8);
  assert.ok(!first.includes(2), "the east side is inside the taller neighbour");
  assert.ok(first.includes(5), "a raised box shows its bottom");
});

const GAMES = process.env.JSTRAXX_GAMES ?? `${process.env.HOME}/games`;
test("every stock MTM2 model decodes into Traxx's axes", { skip: (await import("node:fs")).existsSync(`${GAMES}/mtm2/ALASKA.POD`) ? false : "no MTM2" }, async () => {
  const { readFileSync } = await import("node:fs");
  const { parsePod } = await import("../src/vendor/openphotex/pod/parse.js");
  const { readPodEntry } = await import("../src/vendor/openphotex/pod/lookup.js");
  const { modelGeometry } = await import("../src/core/view/model-geometry.ts");
  const bytes = new Uint8Array(readFileSync(`${GAMES}/mtm2/ALASKA.POD`));
  const pod = parsePod(bytes);
  let drawn = 0;
  for (const e of pod.entries.filter((x) => x.name.endsWith(".BIN"))) {
    const g = modelGeometry(readPodEntry(bytes, e));
    assert.ok(g, e.name);
    if (g.groups.length) drawn++;
    for (const grp of g.groups) assert.equal(grp.positions.length / 3, grp.uvs.length / 2);
  }
  assert.ok(drawn > 5);
});

test("picking finds the first terrain cell along the ray", async () => {
  const { pickTerrain } = await import("../src/core/view/pick.ts");
  const flatHeights = new Uint8Array(65536).fill(10);
  const down = pickTerrain(flatHeights, [1000, 2000, 500], [0, 0, -1]);
  assert.ok(down);
  assert.deepEqual(down.cell, [Math.floor(1000 / 64), Math.floor(2000 / 64)]);
  assert.ok(Math.abs(down.point[2] - 30) < 1e-6);
  // A slanted ray from outside the map hits a wall of high ground.
  const wall = new Uint8Array(65536).fill(0);
  for (let j = 0; j < 256; j++) for (let i = 100; i < 256; i++) wall[i + (j << 8)] = 200;
  const hit = pickTerrain(wall, [-500, 3000, 300], [1, 0, -0.01]);
  assert.ok(hit);
  assert.equal(hit.cell[0], 99, "the slope up to the plateau starts in cell 99");
  assert.equal(pickTerrain(flatHeights, [1000, 2000, 500], [0, 0, 1]), null, "looking up misses");
  assert.equal(pickTerrain(flatHeights, [-100, -100, 5], [-1, 0, 0]), null, "looking away from the map misses");
});

test("orbiting keeps the distance to the pivot and faces it", () => {
  const cam = new TraxxCamera();
  const pivot: [number, number, number] = [8192, 9192, 300];
  cam.x = 8192; cam.y = 8192; cam.z = 300;
  cam.orbit(pivot, 900, 0);
  assert.ok(Math.abs(Math.hypot(cam.x - pivot[0], cam.y - pivot[1], cam.z - pivot[2]) - 1000) < 2);
  // A quarter turn about the pivot puts the camera east or west of it, facing back at it.
  assert.ok(Math.abs(cam.y - pivot[1]) < 2);
  const toPivot = (Math.atan2(pivot[0] - cam.x, pivot[1] - cam.y) * 1800) / Math.PI;
  assert.ok(Math.abs((((cam.orientation - toPivot) % 3600) + 3600) % 3600) < 2 || Math.abs((((cam.orientation - toPivot) % 3600) + 3600) % 3600 - 3600) < 2);
  assert.equal(cam.elevation, 900);
});

test("the three.js camera looks where Traxx's does: north at 0, east to the right, down at 1800", async () => {
  const THREE = await import("three");
  const { applyTraxxCamera } = await import("../src/render/camera-math.ts");
  const cam = new THREE.PerspectiveCamera(57.5, 4 / 3, 4, 40000);
  const ndc = (p: [number, number, number]) => new THREE.Vector3(...p).project(cam);
  applyTraxxCamera(cam, { x: 1000, y: 1000, z: 300, orientation: 0, elevation: 900 });
  const ahead = ndc([1000, 2000, 300]);
  assert.ok(Math.abs(ahead.x) < 1e-6 && Math.abs(ahead.y) < 1e-6 && ahead.z < 1, "north is straight ahead");
  assert.ok(ndc([1100, 2000, 300]).x > 0, "east is to the right");
  assert.ok(ndc([1000, 2000, 400]).y > 0, "higher is up the screen");
  applyTraxxCamera(cam, { x: 1000, y: 1000, z: 300, orientation: 900, elevation: 900 });
  assert.ok(Math.abs(ndc([2000, 1000, 300]).x) < 1e-6, "orientation 900 faces east");
  applyTraxxCamera(cam, { x: 1000, y: 1000, z: 300, orientation: 0, elevation: 1800 });
  const below = ndc([1000, 1000, 0]);
  assert.ok(Math.abs(below.x) < 1e-6 && Math.abs(below.y) < 1e-6, "1800 looks straight down");
  assert.ok(ndc([1000, 1100, 0]).y > 0, "looking down, north is up the screen");
  applyTraxxCamera(cam, { x: 1000, y: 1000, z: 300, orientation: 0, elevation: 800 });
  assert.ok(ndc([1000, 2000, 300]).y < 0, "elevation under 900 looks up, so the level horizon drops");
});
