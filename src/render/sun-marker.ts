/*
  The sun markers (COpenGLTerrainRenderer::DrawSunMarker), shown with View > Show Sun.

  Traxx 1.7.2 (ec6aafb, 3d5c18b): a yellow disc 140 px across with a dark 2 px outline, 96
  segments, fixed on-screen size, drawn after the scene at the far plane, depth-tested and never
  writing depth, so terrain and objects in front hide it.

  Traxx 1.8.0 (b6d56f2): the big disc sits where the GAME draws the visible sun, the LVL vector
  with its engine y halved (EngineVisibleSunDirection, weather.cpp:300-302); a small cyan ring
  (48 px across, 2.5 px over a 5 px dark halo, a 5 px centre dot) marks the real light / shadow
  direction (SunSkyDirection), drawn last so it is on top. Both go through EngineDirToTraxxWorld
  (128 world units a foot across, 96 up), which fixes the 4/3 elevation stretch the 1.7.2 marker
  had. Neither is drawn for a zero vector or a sun at or below the horizon; each is skipped
  behind the camera or wholly off screen.
*/
import * as THREE from "three";
import { sunSkyDirection } from "../core/edit/engine-light.ts";
import { engineDirToTraxxWorld, engineVisibleSunDirection } from "../core/view/engine-sky.ts";

/** 140 px across. */
export const SUN_MARKER_RADIUS = 70;
const SEGMENTS = 96;
/** The outline: 2 px, centred on the disc's edge. */
const OUTLINE = 2;

/** The light / shadow ring: 48 px across. */
export const SUN_RING_RADIUS = 24;

/**
  SunMarkerScreenPos: where an engine direction (x, y up, z) falls through `camera` in a w x h view,
  in pixels from the bottom-left (GL window coordinates), or null behind the camera or with a
  marker of `margin` px wholly off screen.
*/
export function sunMarkerScreenPos(dir: readonly number[], camera: THREE.Camera, w: number, h: number, margin: number): [number, number] | null {
  const wd = engineDirToTraxxWorld(dir);
  camera.updateMatrixWorld();
  // A direction (w = 0): the camera's rotation only, as Traxx takes the modelview's 3 x 3.
  const v = new THREE.Vector4(wd[0], wd[1], wd[2], 0).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
  if (!(v.w > 1e-9)) return null;
  const sx = (v.x / v.w + 1) * 0.5 * w, sy = (v.y / v.w + 1) * 0.5 * h;
  if (!(sx > -margin - 1 && sx < w + margin + 1 && sy > -margin - 1 && sy < h + margin + 1)) return null;
  return [sx, sy];
}

/** The big disc's centre (the visible sun), or null when it is not drawn. */
export function sunMarkerCentre(vector: readonly number[], camera: THREE.Camera, w: number, h: number): [number, number] | null {
  const dirvis = engineVisibleSunDirection(vector), dirlight = sunSkyDirection(vector);
  if (!dirvis || !dirlight) return null;
  return sunMarkerScreenPos(dirvis, camera, w, h, SUN_MARKER_RADIUS);
}

/** The small ring's centre (the light / shadow direction), or null when it is not drawn. */
export function sunRingCentre(vector: readonly number[], camera: THREE.Camera, w: number, h: number): [number, number] | null {
  const dirvis = engineVisibleSunDirection(vector), dirlight = sunSkyDirection(vector);
  if (!dirvis || !dirlight) return null;
  return sunMarkerScreenPos(dirlight, camera, w, h, SUN_RING_RADIUS);
}

const vertexShader = /* glsl */ `
  uniform vec2 uCentre;
  uniform vec2 uSize;
  void main() {
    vec2 p = uCentre + position.xy;
    // z = w: window depth 1.0, the far plane, inside the clip volume.
    gl_Position = vec4(p / uSize * 2.0 - 1.0, 1.0, 1.0);
  }
`;
const fragmentShader = /* glsl */ `
  uniform vec3 uColour;
  void main() { gl_FragColor = vec4(uColour, 1.0); }
`;

function material(colour: [number, number, number]): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: { uCentre: { value: new THREE.Vector2() }, uSize: { value: new THREE.Vector2(1, 1) }, uColour: { value: new THREE.Vector3(...colour.map((c) => c / 255)) } },
    depthTest: true, depthWrite: false, depthFunc: THREE.LessEqualDepth, side: THREE.DoubleSide,
  });
}

export class SunMarker {
  private readonly disc = new THREE.Scene();
  private readonly ring = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  private readonly discMats: THREE.ShaderMaterial[];
  private readonly ringMats: THREE.ShaderMaterial[];

  constructor() {
    const at = (i: number, r: number) => {
      const a = (2 * Math.PI * i) / SEGMENTS;
      return [r * Math.cos(a), r * Math.sin(a), 0];
    };
    const fan = (r: number) => {
      const pts: number[] = [];
      for (let i = 0; i < SEGMENTS; i++) pts.push(0, 0, 0, ...at(i, r), ...at(i + 1, r));
      return pts;
    };
    // A line loop `width` px wide, centred on radius r: a ring of triangles (WebGL lines are 1 px).
    const loop = (r: number, width: number) => {
      const pts: number[] = [];
      const r0 = r - width / 2, r1 = r + width / 2;
      for (let i = 0; i < SEGMENTS; i++) {
        const a0 = at(i, r0), a1 = at(i + 1, r0), b0 = at(i, r1), b1 = at(i + 1, r1);
        pts.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
      }
      return pts;
    };
    const mesh = (pts: number[], m: THREE.ShaderMaterial, order: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const o = new THREE.Mesh(g, m);
      o.frustumCulled = false;
      o.renderOrder = order;
      return o;
    };
    // The visible sun: glColor3ub(255, 220, 60) fan, glColor3ub(60, 45, 10) 2 px loop.
    this.discMats = [material([255, 220, 60]), material([60, 45, 10])];
    this.disc.add(mesh(fan(SUN_MARKER_RADIUS), this.discMats[0]!, 0), mesh(loop(SUN_MARKER_RADIUS, OUTLINE), this.discMats[1]!, 1));
    // The light direction: a 5 px (0, 40, 60) halo, a 2.5 px (0, 230, 255) ring and a 5 px dot.
    this.ringMats = [material([0, 40, 60]), material([0, 230, 255])];
    this.ring.add(mesh(loop(SUN_RING_RADIUS, 5), this.ringMats[0]!, 0), mesh(loop(SUN_RING_RADIUS, 2.5), this.ringMats[1]!, 1), mesh(fan(2.5), this.ringMats[1]!, 2));
  }

  /** Draw over the frame `renderer` has just drawn with `view`, keeping its depth buffer. */
  render(renderer: THREE.WebGLRenderer, view: THREE.Camera, vector: readonly number[] | null, w: number, h: number): void {
    if (!vector) return;
    const d = sunMarkerCentre(vector, view, w, h), l = sunRingCentre(vector, view, w, h);
    if (!d && !l) return;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    const draw = (scene: THREE.Scene, mats: THREE.ShaderMaterial[], c: [number, number]) => {
      for (const m of mats) { m.uniforms.uCentre!.value.set(c[0], c[1]); m.uniforms.uSize!.value.set(w, h); }
      renderer.render(scene, this.camera);
    };
    if (d) draw(this.disc, this.discMats, d);
    if (l) draw(this.ring, this.ringMats, l);
    renderer.autoClear = auto;
  }
}
