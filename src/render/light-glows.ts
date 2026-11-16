/*
  Every light box's GLOW and CONE as the game draws them (Traxx 1.8.0, 58c5475:
  Traxx/OpenGLLightGlow.cpp COpenGLTerrainRenderer::DrawLightGlows and TraxxViewDisplay.cpp
  DrawLightGlowsOpenGL), shown with View > Visual Helpers > Show Light Glows.

  The rules (gates, brightness step, fog fade, geometry, UVs, alpha, dust hash) are
  core/edit/engine-glow-cone.ts's; the art is ART\HEADLITE.RAW and ART\LITEFUZZ.RAW, each with its
  own .ACT, read at run time from the Game Library in mount order (core/view/game-pods.ts), never
  bundled. With its own .ACT a texel whose r, g and b are all under 8 is transparent; without
  one, through the level palette (the track's, or ART\OLDMTM.ACT for an original MTM level), index
  0 is. No PODs or no art: nothing is drawn and the status bar says why.

  States as the engine's: glow SRC_ALPHA / ONE, cone SRC_ALPHA / ONE_MINUS_SRC_ALPHA; pixel = tex.rgb
  * tint, alpha = tex.a * vertex alpha; depth test (LEQUAL) on, depth write off, no culling,
  REPEAT, linear. Per light glow then cone, in .SIT order, after the fog volumes. Only the first
  128 lights count (MAX_LIGHT_PROPS), glow mode 0 ones included.

  SCREEN-LINEAR ALPHA: every vertex is transformed on the CPU, each triangle clipped against the
  near plane in clip space, divided by w and sent at w = 1, so the colour (alpha) interpolates
  linearly on the screen as the engine's noperspective colour does, while the texture coordinate
  goes as (u/w, v/w, 1/w) and the shader divides per fragment (perspective-correct UVs).

  Not modelled, as in Traxx: headlightFlag (1), visibleTiles (150: 3840 ft), lightFogFade, the
  world wrap, the water reflection pass, HD siblings of the two textures.
*/
import * as THREE from "three";
import {
  ENGINEGLOWCONE_CONEACT, ENGINEGLOWCONE_CONESIDE, ENGINEGLOWCONE_CONESIDES, ENGINEGLOWCONE_CONETEX, ENGINEGLOWCONE_GLOWACT, ENGINEGLOWCONE_GLOWSIDE,
  ENGINEGLOWCONE_GLOWTEX, ENGINEGLOWCONE_KEY_BELOW, ENGINEGLOWCONE_MAX_LIGHT_PROPS, engineGlowConeBuild, type GlowConeResult, type GlowConeVertex,
} from "../core/edit/engine-glow-cone.ts";
import { ENGINELIGHT_WORLDXY_PERFOOT, ENGINELIGHT_WORLDZ_PERFOOT, engineSkyLevelPalette, engineSkyLoadAct } from "../core/view/engine-sky.ts";
import type { GamePods } from "../core/view/game-pods.ts";
import { traxxIposToSit, TRAXX_BOX_LIGHT, type TraxxBox, type TraxxLight } from "../core/traxx/sit.ts";
import { ALTITUDE_SCALE } from "../core/view/camera.ts";

/** One light as DrawLightGlowsOpenGL collects it. */
export interface GlowLight {
  /** The box origin in scene units (where its model is drawn). */
  scene: [number, number, number];
  /** The same point as the .SIT writes it, engine feet (x, y up, z), float32. */
  feet: [number, number, number];
  /** theta, phi, psi. */
  rot: [number, number, number];
  light: TraxxLight;
  allWx: number;
}

/**
  DrawLightGlowsOpenGL's list: the first 128 light boxes in box order (glow mode 0 counts but is not
  listed); `effective` gives a dialog's working copy for the box it previews.
*/
export function glowLightsOf(boxes: readonly TraxxBox[], effective: (box: TraxxBox) => { light: TraxxLight; isLight: boolean }): GlowLight[] {
  const out: GlowLight[] = [];
  let nlights = 0;
  for (const box of boxes) {
    if (nlights >= ENGINEGLOWCONE_MAX_LIGHT_PROPS) break;
    const { light, isLight } = effective(box);
    if (!isLight) continue;
    nlights++;
    if (light.glowMode === 0) continue;
    out.push({
      scene: [box.ipos[0] + (box.fraction[0] >> 2) / 64, box.ipos[1] + (box.fraction[1] >> 2) / 64, (ALTITUDE_SCALE * ((box.ipos[2] << 6) + (box.fraction[2] >> 2))) / 64],
      feet: [Math.fround(traxxIposToSit(box.ipos[0], box.fraction[0])), Math.fround(2.0 * box.ipos[2] + box.fraction[2] / 128.0), Math.fround(traxxIposToSit(box.ipos[1], box.fraction[1]))],
      rot: [box.theta, box.phi, box.psi],
      light,
      // The .SIT's 13th 'L' field (Traxx 1.8.0); 0 on a light model without it.
      allWx: (light as TraxxLight & { allWx?: number }).allWx ?? 0,
    });
  }
  return out;
}

/** A box is a light by its own type (no preview). */
export const ownLight = (box: TraxxBox) => ({ light: box.light, isLight: box.type === TRAXX_BOX_LIGHT });

/** GlowBuild: the RAW through its own .ACT (keyed on colour) or the level palette (keyed on index 0). */
export function glowImage(raw: Uint8Array, ownAct: Uint8Array | null, levelPal: Uint8Array, expectSide: number): { rgba: Uint8Array<ArrayBuffer>; side: number } {
  const act = ownAct ?? levelPal;
  let side = 1;
  while (side * side < raw.length) side *= 2;
  if (side * side !== raw.length || side > 1024) side = expectSide;
  const rgba = new Uint8Array(side * side * 4);
  for (let i = 0; i < side * side; i++) {
    const idx = i < raw.length ? raw[i]! : 0;
    const r = act[idx * 3]!, g = act[idx * 3 + 1]!, b = act[idx * 3 + 2]!;
    rgba.set([r, g, b, ownAct ? (r < ENGINEGLOWCONE_KEY_BELOW && g < ENGINEGLOWCONE_KEY_BELOW && b < ENGINEGLOWCONE_KEY_BELOW ? 0 : 255) : idx !== 0 ? 255 : 0], i * 4);
  }
  return { rgba, side };
}

const vertexShader = /* glsl */ `
  attribute vec4 aColour;
  attribute vec3 aTex;
  varying vec4 vColour;
  varying vec3 vTex;
  void main() {
    vColour = aColour;
    vTex = aTex;
    gl_Position = vec4(position, 1.0);
  }
`;
const fragmentShader = /* glsl */ `
  uniform sampler2D uTex;
  varying vec4 vColour;
  varying vec3 vTex;
  void main() {
    vec4 t = texture2D(uTex, vTex.xy / vTex.z);
    gl_FragColor = vec4(t.rgb * vColour.rgb, t.a * vColour.a);
  }
`;

interface ClipVert { c: [number, number, number, number]; u: number; v: number; a: number }

export class LightGlowLayer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  private glowTex: { key: string; tex: THREE.DataTexture | null } = { key: "", tex: null };
  private coneTex: { key: string; tex: THREE.DataTexture | null } = { key: "", tex: null };
  private loading = new Set<string>();
  /** The status note (LightGlowNote), "" when nothing to say. */
  note = "";
  /** Called when a texture finished loading (to redraw). */
  onLoaded: () => void = () => {};

  /*
    Ensure a texture for the pods and palette as they are; returns the texture once loaded (null while
    loading or when it cannot be read). A failed build is not retried until the key changes.
  */
  private ensure(slot: { key: string; tex: THREE.DataTexture | null }, pods: GamePods, rawName: string, actName: string, side: number,
    trackPal: Uint8Array, levelType4: boolean): void {
    let h = 2166136261;
    for (let i = 0; i < 768; i++) { h ^= trackPal[i] ?? 0; h = Math.imul(h, 16777619) >>> 0; }
    const key = `${pods.generation}|${rawName}|${levelType4}|${h}`;
    if (slot.key === key || this.loading.has(key)) return;
    this.loading.add(key);
    void (async () => {
      const raw = await pods.read("art", rawName);
      let tex: THREE.DataTexture | null = null;
      if (raw) {
        const own = await engineSkyLoadAct(pods, actName);
        const level = await engineSkyLevelPalette(pods, levelType4, trackPal);
        const img = glowImage(raw, own ? own.act : null, level, side);
        tex = new THREE.DataTexture(new Uint8Array(img.rgba), img.side, img.side, THREE.RGBAFormat);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearFilter;
        tex.flipY = false;
        tex.needsUpdate = true;
      }
      this.loading.delete(key);
      slot.tex?.dispose();
      slot.key = key;
      slot.tex = tex;
      this.onLoaded();
    })();
  }

  /** Draw over the frame `renderer` has just drawn with `view`, keeping its depth buffer. */
  render(renderer: THREE.WebGLRenderer, view: THREE.Camera, lights: readonly GlowLight[], weather: number, pods: GamePods | null,
    trackPal: Uint8Array, levelType4: boolean): void {
    this.note = "";
    if (!lights.length) return;
    view.updateMatrixWorld();
    const m = new THREE.Matrix4().multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse);
    const eyeScene = new THREE.Vector3().setFromMatrixPosition(view.matrixWorld);
    const fwd = new THREE.Vector3();
    view.getWorldDirection(fwd);
    // Scene units are world units / 64: the forward in engine feet (x, y up, z), normalised there.
    const S = 64;
    const fwdft = [(fwd.x * S) / ENGINELIGHT_WORLDXY_PERFOOT, (fwd.z * S) / ENGINELIGHT_WORLDZ_PERFOOT, (fwd.y * S) / ENGINELIGHT_WORLDXY_PERFOOT];
    const fl = Math.hypot(fwdft[0]!, fwdft[1]!, fwdft[2]!);
    if (!(fl > 1e-12)) return;
    for (let k = 0; k < 3; k++) fwdft[k]! /= fl;
    const res: GlowConeResult[] = [];
    let wantGlow = false, wantCone = false;
    for (const L of lights) {
      const eyeft = [
        L.feet[0] + ((eyeScene.x - L.scene[0]) * S) / ENGINELIGHT_WORLDXY_PERFOOT,
        L.feet[1] + ((eyeScene.z - L.scene[2]) * S) / ENGINELIGHT_WORLDZ_PERFOOT,
        L.feet[2] + ((eyeScene.y - L.scene[1]) * S) / ENGINELIGHT_WORLDXY_PERFOOT,
      ];
      const r = engineGlowConeBuild(L.light, L.allWx, L.feet, L.rot, eyeft, fwdft, weather);
      res.push(r);
      if (r.hasGlow) wantGlow = true;
      if (r.hasCone) wantCone = true;
    }
    if (!wantGlow && !wantCone) return;
    if (!pods || !pods.mounted) {
      this.note = "Light glows: no game PODs are in the Game Library, so glows and cones are not drawn.";
      return;
    }
    if (wantGlow) this.ensure(this.glowTex, pods, ENGINEGLOWCONE_GLOWTEX, ENGINEGLOWCONE_GLOWACT, ENGINEGLOWCONE_GLOWSIDE, trackPal, levelType4);
    if (wantCone) this.ensure(this.coneTex, pods, ENGINEGLOWCONE_CONETEX, ENGINEGLOWCONE_CONEACT, ENGINEGLOWCONE_CONESIDE, trackPal, levelType4);
    const glowReady = this.glowTex.key !== "" && !this.loading.size, coneReady = this.coneTex.key !== "" && !this.loading.size;
    if (wantGlow && glowReady && !this.glowTex.tex && wantCone && coneReady && !this.coneTex.tex)
      this.note = "Light glows: ART\\HEADLITE.RAW and ART\\LITEFUZZ.RAW could not be read from the Game Library, so glows and cones are not drawn.";
    else if (wantGlow && glowReady && !this.glowTex.tex) this.note = "Light glows: ART\\HEADLITE.RAW could not be read from the Game Library, so glows are not drawn.";
    else if (wantCone && coneReady && !this.coneTex.tex) this.note = "Light glows: ART\\LITEFUZZ.RAW could not be read from the Game Library, so cones are not drawn.";

    // GlowToClip: engine feet (box-relative) -> scene -> clip.
    const toClip = (L: GlowLight, v: GlowConeVertex): ClipVert => {
      const wx = L.scene[0] + ((v.world[0]! - L.feet[0]) * ENGINELIGHT_WORLDXY_PERFOOT) / S;
      const wy = L.scene[1] + ((v.world[2]! - L.feet[2]) * ENGINELIGHT_WORLDXY_PERFOOT) / S;
      const wz = L.scene[2] + ((v.world[1]! - L.feet[1]) * ENGINELIGHT_WORLDZ_PERFOOT) / S;
      const e = m.elements;
      const c: [number, number, number, number] = [0, 1, 2, 3].map((r) => e[r]! * wx + e[4 + r]! * wy + e[8 + r]! * wz + e[12 + r]!) as [number, number, number, number];
      return { c, u: v.u, v: v.v, a: v.alpha8 };
    };
    this.scene.clear();
    let order = 0;
    res.forEach((R, i) => {
      if (!R.drawn) return;
      const L = lights[i]!;
      const rgb = [R.rgb[0] / 255, R.rgb[1] / 255, R.rgb[2] / 255];
      if (R.hasGlow && this.glowTex.tex) this.addQuads(R.glow, 1, L, toClip, rgb, this.glowTex.tex, true, order++);
      if (R.hasCone && this.coneTex.tex) this.addQuads(R.cone, ENGINEGLOWCONE_CONESIDES, L, toClip, rgb, this.coneTex.tex, false, order++);
    });
    if (!this.scene.children.length) return;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
    for (const c of this.scene.children) { (c as THREE.Mesh).geometry.dispose(); ((c as THREE.Mesh).material as THREE.Material).dispose(); }
    this.scene.clear();
  }

  private addQuads(vs: readonly GlowConeVertex[], nquads: number, L: GlowLight, toClip: (L: GlowLight, v: GlowConeVertex) => ClipVert, rgb: number[],
    tex: THREE.Texture, additive: boolean, order: number): void {
    const pos: number[] = [], col: number[] = [], uv: number[] = [];
    // GlowEmitTriangle: clip against z + w >= 0, then divide by w (w = 1 to the GPU).
    const tri = (t: ClipVert[]) => {
      const out: ClipVert[] = [];
      for (let i = 0; i < 3; i++) {
        const p = t[i]!, q = t[(i + 1) % 3]!;
        const dp = p.c[2] + p.c[3], dq = q.c[2] + q.c[3];
        if (dp >= 0) out.push(p);
        if (dp >= 0 !== dq >= 0) {
          const s = dp / (dp - dq);
          out.push({ c: [0, 1, 2, 3].map((k) => p.c[k]! + (q.c[k]! - p.c[k]!) * s) as [number, number, number, number], u: p.u + (q.u - p.u) * s, v: p.v + (q.v - p.v) * s, a: p.a + (q.a - p.a) * s });
        }
      }
      for (let i = 1; i + 1 < out.length; i++) {
        for (const f of [out[0]!, out[i]!, out[i + 1]!]) {
          let w = f.c[3];
          if (!(w > 1e-9)) w = 1e-9;
          const q = 1 / w;
          pos.push(f.c[0] * q, f.c[1] * q, f.c[2] * q);
          col.push(rgb[0]!, rgb[1]!, rgb[2]!, f.a / 255);
          uv.push(f.u * q, f.v * q, q);
        }
      }
    };
    for (let q = 0; q < nquads; q++) {
      const c = [0, 1, 2, 3].map((k) => toClip(L, vs[q * 4 + k]!));
      tri([c[0]!, c[1]!, c[2]!]); // (0,1,2), (0,2,3): the engine's split
      tri([c[0]!, c[2]!, c[3]!]);
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aColour", new THREE.Float32BufferAttribute(col, 4));
    g.setAttribute("aTex", new THREE.Float32BufferAttribute(uv, 3));
    const mat = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, uniforms: { uTex: { value: tex } },
      transparent: true, depthTest: true, depthWrite: false, depthFunc: THREE.LessEqualDepth, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor,
      blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    this.scene.add(mesh);
  }

  /** The context is going: forget the textures. */
  dispose(): void {
    this.glowTex.tex?.dispose();
    this.coneTex.tex?.dispose();
    this.glowTex = { key: "", tex: null };
    this.coneTex = { key: "", tex: null };
  }
}
