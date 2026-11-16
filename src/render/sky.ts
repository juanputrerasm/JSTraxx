/*
  The game's sky in the 3D view (Traxx 1.8.0, b6d56f2: Traxx/OpenGLSky.cpp
  COpenGLTerrainRenderer::DrawSky, Traxx/EngineSky.cpp), shown with View > Visual Helpers > Show
  Sky, not over a wireframe.

    - The fog fill (fogOutWindow): Snow, Foggy, Dense fog and Pitch black always (and then no
      backdrop is drawn, as in the engine); the dome weathers only when no backdrop is drawn.
    - The dome: the sky the engine picks for the Preview Weather (engineSkyChoose: cloudy2 for an
      MTM2 track, aliensky / earthsky for an original MTM level; dusk / rain / night swap in
      dusksky / cclouds / nitesky; cloudy2 when the picked art is missing), its .ACT 192..207 put
      over the level palette's 230..245, greyed in Cloudy, an HD PNG / TGA sibling when the library
      has one; the eye-centred 16-segment dome with its one-colour cap first; unlit, no depth.
    - The ball: the sun (Clear) or the moon (Night), additive, a screen square at the LVL vector
      with y halved (engineSunBallDirection), whenever it is in front of the eye.
    - Depth is cleared afterwards (nothing here wrote it).

  The art is read at run time from the Game Library in mount order (game-pods.ts), never bundled.
  No PODs, or no sky art: a plain colour and a status note saying why.
*/
import * as THREE from "three";
import {
  engineDirToTraxxWorld, engineSkyBallFor, engineSkyBallKey, engineSkyBuildBall, engineSkyBuildDome, engineSkyChoose, engineSkyDomeKey,
  engineSkyDomeWorld, engineSkyFogColour, engineSkyHasDome, engineSkyHash, engineSkyBallScreen, engineSkyLevelPalette, engineSkyNote, engineSkyTrackNames,
  engineSunBallDirection, type EngineSkyChoice,
} from "../core/view/engine-sky.ts";
import type { GamePods } from "../core/view/game-pods.ts";
import { tryDecodeImage } from "../shared/image-decode.ts";

/** The dome's scale: R = 1024 ft through engineDirToTraxxWorld is 131072 world units; a scene unit is 64. */
const DOME_SCALE = 1 / 64;

function texture(rgba: Uint8Array, side: number): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(rgba), side, side, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

export interface SkyInput {
  weather: number;
  /** The track's 768-byte palette (the level palette). */
  palette: Uint8Array;
  /** MTM2_ONLY clear: an original MTM level (levelType 4). */
  levelType4: boolean;
  /** The LVL vector (the direction light travels), or null. */
  sun: readonly number[] | null;
  /** A backdrop will be drawn after the sky. */
  backdrop: boolean;
}

export class SkyLayer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 1, 1e7);
  private readonly ballScene = new THREE.Scene();
  private readonly ballCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  private dome: THREE.Mesh;
  private cap: THREE.Mesh;
  private ball: THREE.Mesh;
  private domeState: { key: string; tex: THREE.DataTexture | null; cap: [number, number, number]; note: string } = { key: "", tex: null, cap: [0, 0, 0], note: "" };
  private ballState: { key: string; tex: THREE.DataTexture | null; texSide: number } = { key: "", tex: null, texSide: 1 };
  private choice: { key: string; choice: EngineSkyChoice | null; rawLength: number; levelPal: Uint8Array | null } = { key: "", choice: null, rawLength: -1, levelPal: null };
  private busy = new Set<string>();
  /** SkyNote: the status-bar text, "" when the sky shows as the game shows it. */
  note = "";
  /** Called when something loaded (to redraw). */
  onLoaded: () => void = () => {};

  constructor() {
    const w = engineSkyDomeWorld(DOME_SCALE);
    const dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.Float32BufferAttribute(w.positions, 3));
    dg.setAttribute("uv", new THREE.Float32BufferAttribute(w.uvs, 2));
    this.dome = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
    const cg = new THREE.BufferGeometry();
    cg.setAttribute("position", new THREE.Float32BufferAttribute(w.cap, 3));
    cg.setIndex([0, 1, 2, 0, 2, 3]);
    this.cap = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
    this.cap.renderOrder = 0;
    this.dome.renderOrder = 1;
    for (const m of [this.dome, this.cap]) m.frustumCulled = false;
    this.scene.add(this.cap, this.dome);
    this.camera.up.set(0, 0, 1);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    bg.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(8), 2));
    bg.setIndex([0, 1, 2, 0, 2, 3]);
    this.ball = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({
      color: 0xffffff, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    }));
    this.ball.frustumCulled = false;
    this.ballScene.add(this.ball);
  }

  /** The engine's draw-the-backdrop rule: no backdrop in the fill weathers. */
  static backdropShows(weather: number): boolean {
    return engineSkyHasDome(weather);
  }

  /*
    The dome's choice, palette and image, and the ball's, resolved asynchronously through the
    library; each keyed as DrawSky keys them, a failed build not retried until its key changes.
  */
  private resolve(pods: GamePods, inp: SkyInput): void {
    const names = engineSkyTrackNames(!inp.levelType4);
    const ckey = `${pods.generation}|${inp.weather}|${inp.levelType4}|${engineSkyHash(inp.palette.subarray(0, 768))}`;
    if (this.choice.key !== ckey && !this.busy.has(ckey)) {
      this.busy.add(ckey);
      void (async () => {
        const choice = await engineSkyChoose(pods, inp.weather, names.levelType4, names.raw, names.act);
        const rawLength = await pods.length("art", choice.raw);
        const levelPal = await engineSkyLevelPalette(pods, names.levelType4, inp.palette);
        this.busy.delete(ckey);
        this.choice = { key: ckey, choice, rawLength, levelPal };
        this.onLoaded();
      })();
    }
    const c = this.choice;
    if (c.key !== ckey || !c.choice || !c.levelPal) return;
    const note = engineSkyNote(pods.mounted, c.choice, c.rawLength, inp.weather, names.levelType4, names.raw, names.act);
    this.note = note;
    if (!pods.mounted || c.rawLength <= 0) return;
    const dkey = engineSkyDomeKey(pods.generation, c.choice, c.levelPal);
    if (this.domeState.key !== dkey && !this.busy.has(dkey)) {
      this.busy.add(dkey);
      const choice = c.choice, levelPal = c.levelPal;
      void (async () => {
        const img = await engineSkyBuildDome(pods, choice, levelPal, tryDecodeImage);
        this.busy.delete(dkey);
        this.domeState.tex?.dispose();
        if (typeof img === "string") this.domeState = { key: dkey, tex: null, cap: [0, 0, 0], note: img };
        else this.domeState = { key: dkey, tex: texture(img.rgba, img.side), cap: img.cap, note: "" };
        this.onLoaded();
      })();
    }
    if (this.domeState.key === dkey && !this.domeState.tex && this.domeState.note) this.note = this.domeState.note;
    const ball = engineSkyBallFor(inp.weather);
    if (ball) {
      const bkey = engineSkyBallKey(pods.generation, ball);
      if (this.ballState.key !== bkey && !this.busy.has(bkey)) {
        this.busy.add(bkey);
        void (async () => {
          const img = await engineSkyBuildBall(pods, ball, tryDecodeImage);
          this.busy.delete(bkey);
          this.ballState.tex?.dispose();
          this.ballState = { key: bkey, tex: img ? texture(img.rgba, img.side) : null, texSide: img ? img.texSide : 1 };
          this.onLoaded();
        })();
      }
    }
  }

  /**
    Draw the sky into a cleared frame (before the backdrop and the scene) for `view` in a w x h
    view; the caller clears depth afterwards. Returns false when the sky did not draw (the caller
    then clears to its background as before).
  */
  render(renderer: THREE.WebGLRenderer, view: THREE.PerspectiveCamera, inp: SkyInput, pods: GamePods | null, w: number, h: number): void {
    const fog = engineSkyFogColour(inp.weather);
    const hasDome = engineSkyHasDome(inp.weather);
    // The fog fill: the fill weathers always, the dome weathers only with no backdrop.
    if (!hasDome || !inp.backdrop) {
      renderer.setClearColor(new THREE.Color(fog[0] / 255, fog[1] / 255, fog[2] / 255));
      renderer.clear(true, false, false);
    }
    this.note = "";
    if (!hasDome) return;
    if (!pods || !pods.mounted) { this.note = "Sky: no game PODs are in the Game Library, so a plain colour is shown."; return; }
    this.resolve(pods, inp);
    const d = this.domeState;
    if (!d.tex || this.choice.key === "" || !this.choice.choice || d.key !== engineSkyDomeKey(pods.generation, this.choice.choice, this.choice.levelPal!)) return;
    // The eye-centred dome: the view camera's rotation and projection at the origin.
    const cam = this.camera;
    cam.fov = view.fov; cam.aspect = view.aspect; cam.updateProjectionMatrix();
    cam.position.set(0, 0, 0);
    cam.quaternion.copy(view.quaternion);
    cam.updateMatrixWorld();
    const dm = this.dome.material as THREE.MeshBasicMaterial;
    if (dm.map !== d.tex) { dm.map = d.tex; dm.needsUpdate = true; }
    (this.cap.material as THREE.MeshBasicMaterial).color.setRGB(d.cap[0] / 255, d.cap[1] / 255, d.cap[2] / 255);
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, cam);
    // The sun (Clear) or the moon (Night): additive, a screen square at the ball's direction.
    const ball = engineSkyBallFor(inp.weather);
    const dir = inp.sun ? engineSunBallDirection(inp.sun) : null;
    if (ball && dir && this.ballState.tex && this.ballState.key === engineSkyBallKey(pods.generation, ball)) {
      const wd = engineDirToTraxxWorld(dir);
      const v = new THREE.Vector3(wd[0], wd[1], wd[2]).transformDirection(cam.matrixWorldInverse);
      const focal = (h / 2) / Math.tan((cam.fov * Math.PI) / 360);
      const sq = engineSkyBallScreen(ball, this.ballState.texSide, [v.x, v.y, v.z], focal, w, h);
      if (sq) {
        // Pixels with y up from the bottom: the square's top edge (sy - r, y down) is h - (sy - r).
        const x0 = sq.sx - sq.r, x1 = sq.sx + sq.r, yTop = h - (sq.sy - sq.r), yBot = h - (sq.sy + sq.r);
        const pos = this.ball.geometry.getAttribute("position") as THREE.BufferAttribute;
        const uv = this.ball.geometry.getAttribute("uv") as THREE.BufferAttribute;
        // (sx - r, sy + r) u1 v1; (sx + r, sy + r) u2 v1; (sx + r, sy - r) u2 v2; (sx - r, sy - r) u1 v2.
        pos.setXYZ(0, x0, yBot, 0); uv.setXY(0, sq.u1, sq.v1);
        pos.setXYZ(1, x1, yBot, 0); uv.setXY(1, sq.u2, sq.v1);
        pos.setXYZ(2, x1, yTop, 0); uv.setXY(2, sq.u2, sq.v2);
        pos.setXYZ(3, x0, yTop, 0); uv.setXY(3, sq.u1, sq.v2);
        pos.needsUpdate = true; uv.needsUpdate = true;
        const bm = this.ball.material as THREE.MeshBasicMaterial;
        if (bm.map !== this.ballState.tex) { bm.map = this.ballState.tex; bm.needsUpdate = true; }
        const oc = this.ballCamera;
        oc.left = 0; oc.right = w; oc.top = h; oc.bottom = 0; oc.updateProjectionMatrix();
        renderer.render(this.ballScene, oc);
      }
    }
    renderer.autoClear = auto;
  }

  dispose(): void {
    this.domeState.tex?.dispose();
    this.ballState.tex?.dispose();
  }
}
