/*
  Course points on a track built of meshes (core/view/mesh-pick.ts): the pick finds a placed model's floor nearer the
  eye than the terrain, passes through its walls, and leaves fogs and model-less boxes out.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { drivableMeshes, pickMesh } from "../src/core/view/mesh-pick.ts";
import type { ModelGeometry } from "../src/core/view/model-geometry.ts";

/** A model of a 40 x 40 unit deck at local height 0 and one wall along x = 20 rising 20 units. */
function deckModel(): ModelGeometry {
  const deck = [-20, -20, 0, 20, -20, 0, 20, 20, 0, -20, -20, 0, 20, 20, 0, -20, 20, 0];
  const wall = [20, -20, 0, 20, 20, 0, 20, 20, 20, 20, -20, 0, 20, 20, 20, 20, -20, 20];
  const group = (p: number[]) => ({ textureName: "", cutout: false, twoSided: false, color: 0, positions: new Float32Array(p), uvs: new Float32Array(p.length / 3 * 2) });
  return { groups: [group(deck), group(wall)], vertices: new Float32Array(), raw: new Int32Array(), frameNames: [], outlines: new Float32Array(), polygons: 4 };
}

const box = (over: Partial<{ type: number; modelName: string; z: number }> = {}) => ({
  type: over.type ?? 0, modelName: over.modelName ?? "DECK.BIN", ipos: [1000, 1000, over.z ?? 20] as [number, number, number],
  fraction: [0, 0, 0] as [number, number, number], theta: 0, phi: 0, psi: 0,
});

test("a ray down onto a deck stops at the deck, above the terrain; a wall is passed through", () => {
  const meshes = drivableMeshes([box()], (name) => (name === "DECK.BIN" ? deckModel() : null));
  assert.equal(meshes.length, 1);
  // From 600 units up, straight down at the deck's middle: the deck's height is the box's, 3 x 20 scene units.
  const hit = pickMesh(meshes, [1000, 1000, 600], [0, 0, -1]);
  assert.ok(hit);
  assert.ok(Math.abs(hit.point[2] - 60) < 1e-6);
  assert.ok(Math.abs(hit.t - 540) < 1e-6);
  // Sideways into the wall at x = 1020: no hit (a wall is not driven on).
  assert.equal(pickMesh(meshes, [900, 1000, 65], [1, 0, 0]), null);
  // The terrain is nearer: nothing beyond `far` is taken.
  assert.equal(pickMesh(meshes, [1000, 1000, 600], [0, 0, -1], 100), null);
  // Off the deck: the ray misses it.
  assert.equal(pickMesh(meshes, [1100, 1000, 600], [0, 0, -1]), null);
});

test("fogs and boxes without a model are not drivable", () => {
  const meshes = drivableMeshes([box({ type: 14 }), box({ modelName: "" }), box({ modelName: "MISSING.BIN" })], (name) => (name === "DECK.BIN" ? deckModel() : null));
  assert.equal(meshes.length, 0);
});

test("the course mode places points on the drivable surface", () => {
  const mode = readFileSync(new URL("../src/app/modes/course-mode.ts", import.meta.url), "utf8");
  assert.match(mode, /const hit = view\.pickDrivable\(p\.clientX, p\.clientY\);/);
});
