/*
  OverlayLightPool (Traxx/TraxxViewDisplay.cpp): a Light's pool on the ground, in cyan.

    the ring   radius x 2 ipos (the radius is in feet), held to 2 x LIGHT_RADIUS_MAX, 72
               segments, each point on the terrain under it; drawn from 4 ipos up
    the stem   from the ground under the post to the lamp head: the box's height plus the
               height offset (feet; 96 world units a foot vertically, 1.5 scene units)
    the leader from the post to the pool's centre, which the aim offset throws the way the
               box faces: sin(psi) cos(theta) east, cos(psi) cos(theta) north

  Points are scene units: x, y in ipos, z = 3 per terrain step.
*/
import type { TraxxBox, TraxxLight } from "../traxx/sit.ts";
import { interpolateRawAtPoint } from "../traxx/terrain.ts";
import { ALTITUDE_SCALE } from "./camera.ts";

export const LIGHT_RADIUS_MAX = 4095;
const SEGMENTS = 72;
/** World z units a foot (TRAXX_WORLDZ_PERFOOT) over the 64 a scene unit holds. */
const SCENE_Z_PER_FOOT = 96 / 64;

/** Line segments as pairs of [x, y, z] points. */
export function lightPoolLines(box: TraxxBox, light: TraxxLight, heights: Uint8Array): [number, number, number][][] {
  if (light.radius <= 0) return [];
  const ground = (x: number, y: number) => ALTITUDE_SCALE * interpolateRawAtPoint(heights, x, y);
  const radius = Math.min(light.radius * 2, 2 * LIGHT_RADIUS_MAX);
  const aim = Math.max(-LIGHT_RADIUS_MAX, Math.min(LIGHT_RADIUS_MAX, light.aimOffset));
  const m3 = Math.sin(box.psi) * Math.cos(box.theta);
  const m9 = Math.cos(box.psi) * Math.cos(box.theta);
  const [px, py] = box.ipos;
  const cx = px + Math.trunc(aim * 2 * m3), cy = py + Math.trunc(aim * 2 * m9);
  const lines: [number, number, number][][] = [];
  if (radius >= 4) {
    const ring: [number, number, number][] = [];
    for (let s = 0; s <= SEGMENTS; s++) {
      const a = (2 * Math.PI * s) / SEGMENTS;
      const x = cx + Math.trunc(radius * Math.cos(a)), y = cy + Math.trunc(radius * Math.sin(a));
      ring.push([x, y, ground(x, y)]);
    }
    for (let s = 1; s < ring.length; s++) lines.push([ring[s - 1]!, ring[s]!]);
  }
  const base: [number, number, number] = [px, py, ground(px, py)];
  const headZ = ALTITUDE_SCALE * (box.ipos[2] + box.fraction[2] / 256) + light.heightOffset * SCENE_Z_PER_FOOT;
  lines.push([base, [px, py, headZ]]);
  if (cx !== px || cy !== py) lines.push([base, [cx, cy, ground(cx, cy)]]);
  return lines;
}
