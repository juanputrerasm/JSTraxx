/*
  What Light Properties (Traxx 1.8.0, Traxx/LightPropertiesDlg.cpp) says about a light, in one line:
  the parts of EngineLightPool.h/.cpp and EngineGlowCone.h/.cpp the dialog reads (the radius
  quantiser, EngineLightPoolWarning with its texts as 66f5784 words them, and the cone's
  rim-zero gate), plus GetLightGuideContext's inputs.

  Pure functions only. The 3D drawing of the pool, glow and cone (EngineLightPool's other
  functions, OpenGLLightGlow) is the view's and lives with it; these are the pieces a dialog needs
  and the view may share.
*/
import type { TraxxLight } from "./sit.ts";
import { TERRAINMODE_CLASSIC16, TERRAINMODE_CLASSIC8 } from "./terrain16.ts";

/** ENGINELIGHT_POOL_WEATHER_MASK: Foggy, Dense fog, Rain, Dusk, Night, Pitch black. */
export const ENGINELIGHT_POOL_WEATHER_MASK = 4 | 8 | 16 | 64 | 128 | 256;
/** ENGINELIGHT_RADIUS_MIN / MAX: the radius the dialog holds a light to (DDV 1..4095). */
export const ENGINELIGHT_RADIUS_MIN = 1;
export const ENGINELIGHT_RADIUS_MAX = 4095;
/** LVL ambient at or above this leaves rain / fog pools no headroom. */
export const ENGINELIGHT_LVLAMBIENT_NOPOOL = 61440;

export const ENGINELIGHT_WARN_NONE = 0;
export const ENGINELIGHT_WARN_RADIUS_LOW = 1;
export const ENGINELIGHT_WARN_NO_POOL_WEATHER = 2;
export const ENGINELIGHT_WARN_NO_HEADROOM = 3;
export const ENGINELIGHT_WARN_SMALL_POOL = 4;

/** EngineLightRadiusQ: R = min(int(rad), 4095), truncating, no lower clamp. */
export function engineLightRadiusQ(rad: number): number {
  const r = Number.isFinite(rad) ? Math.trunc(Math.fround(rad)) : 0;
  return r > 4095 ? 4095 : r;
}

/** EngineLightPoolWarning: the most serious thing to tell an author about a light on this track. */
export function engineLightPoolWarning(rad: number, weatherMask: number, lvlAmbient: number, coarseGrid: boolean): number {
  const poolWeathers = weatherMask & ENGINELIGHT_POOL_WEATHER_MASK;
  if (engineLightRadiusQ(rad) < 1) return ENGINELIGHT_WARN_RADIUS_LOW;
  if (poolWeathers === 0) return ENGINELIGHT_WARN_NO_POOL_WEATHER;
  // Foggy 4, Dense fog 8 and Rain 16 are the weathers whose ambient comes from the LVL.
  if ((poolWeathers & ~(4 | 8 | 16)) === 0 && lvlAmbient >= ENGINELIGHT_LVLAMBIENT_NOPOOL) return ENGINELIGHT_WARN_NO_HEADROOM;
  if (coarseGrid && engineLightRadiusQ(rad) < 32) return ENGINELIGHT_WARN_SMALL_POOL;
  return ENGINELIGHT_WARN_NONE;
}

/** EngineLightPoolWarningText (66f5784's wording). */
export function engineLightPoolWarningText(warning: number): string {
  switch (warning) {
    case ENGINELIGHT_WARN_RADIUS_LOW: return "Radius under 1: no pool (older games divide by zero).";
    case ENGINELIGHT_WARN_NO_POOL_WEATHER: return "No pools: track weather has no fog/rain/dusk/night.";
    case ENGINELIGHT_WARN_NO_HEADROOM: return "Track ambient too bright: rain/fog pools vanish.";
    case ENGINELIGHT_WARN_SMALL_POOL: return "Under 32 ft: can vanish between ground vertices.";
  }
  return "";
}

/** The cone fields EngineGlowConeHasCone and EngineGlowConeRimZero read. */
export interface GlowConeFields { glowMode: number; coneLength: number; coneRimRadius: number; coneBaseRadius: number }

/** EngineGlowConeHasCone: glowmode >= 2, coneLen > 0 and (coneBase > 0 or coneRim > 0). */
export function engineGlowConeHasCone(l: GlowConeFields): boolean {
  return l.glowMode >= 2 && l.coneLength > 0 && (l.coneBaseRadius > 0 || l.coneRimRadius > 0);
}

/** EngineGlowConeRimZero: the gate passes with coneRim 0 and a base (older engines divide by zero). */
export function engineGlowConeRimZero(l: GlowConeFields): boolean {
  return engineGlowConeHasCone(l) && l.coneRimRadius === 0 && l.coneBaseRadius > 0;
}

/** CTraxxView::GetLightGuideContext: the track's weather mask, LVL ambient and whether the ground is lit on the 32 ft grid. */
export interface LightGuideContext { weatherMask: number; lvlAmbient: number; coarseGrid: boolean }

export function lightGuideContext(track: { weatherMask: number; terrainMode: number; sun: { shadowIntensity: number } | null }): LightGuideContext {
  return {
    weatherMask: track.weatherMask,
    lvlAmbient: track.sun?.shadowIntensity ?? 32768,
    coarseGrid: track.terrainMode === TERRAINMODE_CLASSIC8 || track.terrainMode === TERRAINMODE_CLASSIC16,
  };
}

/**
  CLightPropertiesDlg::UpdateWarning: the one warning line. `radiusFixed` is OnInitDialog's
  m_radiusfixed (the file's radius was under 1 and was raised to 1). The cone fields are as the
  dialog reads them (ReadDlgFloat, 0..4095).
*/
export function lightPropertiesWarning(rad: number, cone: GlowConeFields, ctx: LightGuideContext, radiusFixed: boolean): string {
  const warning = engineLightPoolWarning(rad, ctx.weatherMask, ctx.lvlAmbient, ctx.coarseGrid);
  if (radiusFixed && Math.fround(rad) === ENGINELIGHT_RADIUS_MIN) return "Radius was under 1 in the file: raised to 1.";
  if (warning === ENGINELIGHT_WARN_RADIUS_LOW) return engineLightPoolWarningText(warning);
  if (engineGlowConeRimZero(cone)) return "Cone rim 0 with a base: older games divide by zero.";
  if (warning !== ENGINELIGHT_WARN_NONE) return engineLightPoolWarningText(warning);
  return "Radius = wide.  Height = free.";
}

/** OnInitDialog's m_radiusfixed: a file radius under 1 (EngineLightRadiusQ) the dialog raises to 1. */
export function lightRadiusNeedsRaise(light: TraxxLight): boolean {
  return engineLightRadiusQ(light.radius) < 1;
}
