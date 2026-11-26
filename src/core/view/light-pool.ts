/*
  OverlayLightPool (Traxx/TraxxViewDisplay.cpp): a Light's pool on the ground, and (Traxx 1.8.0,
  6616ea5 and ce4aa17) the light guide.

    the ring   R = min(int(rad), 4095) feet (EngineLightRadiusQ), 2R ipos across the ground, 72
               segments, each point on the ground under it; none for R < 1 (the engine divides by
               zero, the warning says so) or under 4 ipos. Cyan, or dim cyan when the track's
               weather mask has no pool weather (the light then does nothing in game). Never tinted.
    the stem   from the ground under the post to the lamp head: the box's height plus the height
               offset (feet; 96 world units a foot vertically, 1.5 scene units)
    the leader from the post to the pool's centre, which the aim offset throws the way the box
               faces: sin(psi) cos(theta) east, cos(psi) cos(theta) north

  "Ground" is the engine's (Ground.cpp newGroundHeight, LightGroundZUnderHead): a ground box's TOP
  when the lamp head is above that box's bottom, else the terrain.

  The light guide (View > Light Guide > Show Core and Extent, for the Preview Weather), orange:
    core ring  r_core = R * max(0, 1 - (4096 - amb) / (4095.9375 b)), dashed (every other 5 degree
               segment), draped; not drawn when 0 or with no headroom (amb >= 4096)
    extent     on the post: solid to 0.75V above and below the head, 4 dashes from 0.75V to V,
               ticks at 0.75V (3 ft each side) and V (6 ft), V = max(8 hq, R), hq from the head's
               height over the ground under the AIMED point
  and the words at the lamp head: the warning, then the weather's core and extent lines.

  Points are scene units: x, y in ipos, z = 3 per terrain step.
*/
import type { TraxxBox, TraxxLight } from "../traxx/sit.ts";
import { lightGroundZ, type Ground } from "../traxx/box-ground.ts";
import { ALTITUDE_SCALE } from "./camera.ts";
import {
  ENGINELIGHT_WARN_NONE, engineLightAmbientForWeather, engineLightBrightness, engineLightCoreRadius, engineLightHeightQ, engineLightMaskHasPools,
  engineLightPoolWarning, engineLightPoolWarningText, engineLightRadiusQ, engineLightVext,
} from "../edit/engine-light-pool.ts";
import type { LightGuideContext } from "../traxx/light-props.ts";
import { ENGINE_WEATHER_NAMES } from "./engine-sky.ts";

export const LIGHT_RADIUS_MAX = 4095;
const SEGMENTS = 72;
/** TRAXX_WORLDZ_PERFOOT: world z units a foot; a scene unit is 64 world units. */
const WORLDZ_PERFOOT = 96;
/** TRAXX_LIGHTPOOL_COLOUR, TRAXX_LIGHTPOOL_DIM_COLOUR, TRAXX_LIGHTCORE_COLOUR. */
export const LIGHTPOOL_COLOUR = "#00ffff";
export const LIGHTPOOL_DIM_COLOUR = "#006e6e";
export const LIGHTCORE_COLOUR = "#ff8c00";
/** The warning line's colour, RGB(255, 220, 60). */
export const LIGHTWARN_COLOUR = "#ffdc3c";

type P3 = [number, number, number];

/** A ground box's two heights per cell (TxxGroundBox lower / upper, v: 1/128 ft). */
export interface LightGroundBoxes { boxes: readonly { x: number; y: number; lower: number; upper: number }[]; cells: number }

export interface LightPoolDrawing {
  /** The ring, stem and leader: pairs of points, in `ringColour`. */
  lines: [P3, P3][];
  ringColour: string;
  /** The guide (core ring and extent), in LIGHTCORE_COLOUR. */
  guide: [P3, P3][];
  /** The words, at `labelAt` (the lamp head), top down. */
  labels: { text: string; colour: string }[];
  labelAt: P3;
}

/**
  OverlayLightPool for `box` with `light` (a dialog's working copy or its own). `ctx` is
  GetLightGuideContext's; `guide` the View > Light Guide switch and the Preview Weather.
*/
export function lightPoolDrawing(box: TraxxBox, light: TraxxLight, terrain: Ground, gb: LightGroundBoxes | null,
  ctx: LightGuideContext, guide: { show: boolean; weather: number }): LightPoolDrawing {
  const terrainZ = (x: number, y: number) => lightGroundZ(terrain, x, y, ALTITUDE_SCALE);
  const cellBoxes = new Map<number, { lower: number; upper: number }>();
  const m = (gb?.cells ?? 256) - 1;
  if (gb) for (const g of gb.boxes) cellBoxes.set((g.x & m) + (g.y & m) * (m + 1), g);
  const [px, py] = box.ipos;
  // objectworldpos[2] + (int)(heightoffset * 96), in world units, then scene units.
  const boxWorldZ = 64 * ALTITUDE_SCALE * (box.ipos[2] + box.fraction[2] / 256);
  const headWorld = boxWorldZ + Math.trunc(Math.fround(light.heightOffset) * WORLDZ_PERFOOT);
  const headZ = headWorld / 64;
  // LightGroundZUnderHead: ALTITUDESCALE*(byte << 6) world, ALTITUDE_SCALE*byte scene.
  const ground = (x: number, y: number): number => {
    const c = cellBoxes.get(((x >> 6) & m) + ((y >> 6) & m) * (m + 1));
    if (c && c.lower !== c.upper) {
      const bottom = Math.min(c.lower, c.upper), top = Math.max(c.lower, c.upper);
      // In 2 ft steps (v / 256), as LightGroundZUnderHead reads the box layers.
      if (headZ > (ALTITUDE_SCALE * bottom) / 256) return (ALTITUDE_SCALE * top) / 256;
    }
    return terrainZ(x, y);
  };

  const warning = engineLightPoolWarning(light.radius, ctx.weatherMask, ctx.lvlAmbient, ctx.coarseGrid);
  const poolsExist = engineLightMaskHasPools(ctx.weatherMask);
  const R = engineLightRadiusQ(light.radius);
  const iposRadius = R >= 1 ? R * 2 : 0;
  const ringColour = poolsExist ? LIGHTPOOL_COLOUR : LIGHTPOOL_DIM_COLOUR;

  const m3 = Math.fround(Math.sin(box.psi) * Math.cos(box.theta));
  const m9 = Math.fround(Math.cos(box.psi) * Math.cos(box.theta));
  const aim = Math.max(-LIGHT_RADIUS_MAX, Math.min(LIGHT_RADIUS_MAX, Math.fround(light.aimOffset)));
  const f = Math.fround;
  const cx = px + Math.trunc(f(f(aim * 2) * m3)), cy = py + Math.trunc(f(f(aim * 2) * m9));

  const lines: [P3, P3][] = [];
  const ringOf = (radius: number, dashed: boolean, out: [P3, P3][]) => {
    let prev: P3 | null = null;
    for (let s = 0; s <= SEGMENTS; s++) {
      const a = Math.fround((2 * Math.PI * s) / SEGMENTS);
      const x = cx + Math.trunc(radius * Math.fround(Math.cos(a))), y = cy + Math.trunc(radius * Math.fround(Math.sin(a)));
      const cur: P3 = [x, y, ground(x, y)];
      if (prev && (!dashed || (s & 1) === 0)) out.push([prev, cur]);
      prev = cur;
    }
  };
  if (iposRadius >= 4) ringOf(iposRadius, false, lines);
  const base: P3 = [px, py, ground(px, py)];
  lines.push([base, [px, py, headZ]]);
  if (cx !== px || cy !== py) lines.push([base, [cx, cy, ground(cx, cy)]]);

  // THE LIGHT GUIDE.
  const guideLines: [P3, P3][] = [];
  const amb = engineLightAmbientForWeather(guide.weather, ctx.lvlAmbient);
  const drawn = R >= 1 && guide.show && poolsExist && amb >= 0;
  const noHeadroom = amb >= 4096;
  let coreR = 0, vext = R;
  if (drawn && !noHeadroom) {
    const h = (headWorld - 64 * ground(cx, cy)) / WORLDZ_PERFOOT;
    vext = engineLightVext(R, engineLightHeightQ(h));
    coreR = engineLightCoreRadius(R, engineLightBrightness(light.bright), amb);
    if (coreR * 2 >= 2) ringOf(Math.fround(coreR * 2), true, guideLines);
    const tick = 3 * 2; // 3 ft each side, ipos
    const full = 0.75 * vext;
    const zAt = (dy: number) => (headWorld + Math.trunc(dy * WORLDZ_PERFOOT)) / 64;
    for (const sign of [1, -1]) {
      guideLines.push([[px, py, headZ], [px, py, zAt(sign * full)]]);
      const span = vext - full;
      for (let d = 0; d < 8; d += 2) guideLines.push([[px, py, zAt(sign * (full + (span * d) / 8))], [px, py, zAt(sign * (full + (span * (d + 1)) / 8))]]);
      const zf = zAt(sign * full), zv = zAt(sign * vext);
      guideLines.push([[px - tick, py, zf], [px + tick, py, zf]]);
      guideLines.push([[px - 2 * tick, py, zv], [px + 2 * tick, py, zv]]);
    }
  }

  // THE WORDS.
  const labels: { text: string; colour: string }[] = [];
  if (warning !== ENGINELIGHT_WARN_NONE) labels.push({ text: engineLightPoolWarningText(warning), colour: LIGHTWARN_COLOUR });
  if (R >= 1 && guide.show && poolsExist) {
    const name = ENGINE_WEATHER_NAMES[guide.weather] ?? "Clear";
    const note = ctx.weatherMask & (1 << guide.weather) ? "" : " (not in this track's weather mask)";
    let text: string;
    if (amb < 0) text = `No pools in ${name}${note}`;
    else if (noHeadroom) text = `${name}: no headroom, no pool${note}`;
    else if (coreR <= 0) text = `${name}: never saturates - no core ring${note}`;
    else text = `${name}: core ${coreR.toFixed(1)} ft${note}`;
    labels.push({ text, colour: LIGHTCORE_COLOUR });
    if (amb >= 0 && !noHeadroom) labels.push({ text: `Full +/-${Math.trunc(0.75 * vext)} ft from the lamp, gone at +/-${vext} ft`, colour: LIGHTCORE_COLOUR });
  }
  return { lines, ringColour, guide: guideLines, labels, labelAt: [px, py, headZ] };
}

/** The ring, stem and leader alone (Traxx 1.7's call), with no ground boxes and every weather. */
export function lightPoolLines(box: TraxxBox, light: TraxxLight, terrain: Ground): P3[][] {
  return lightPoolDrawing(box, light, terrain, null, { weatherMask: 0x1ff, lvlAmbient: 32768, coarseGrid: false }, { show: false, weather: 0 }).lines;
}
