/*
  Special > Lighting (Traxx 1.7.2, IDD_LIGHTING: Traxx/LightingDlg.cpp, SunPadCtrl.cpp,
  LightPreviewCtrl.cpp). The sun vector (16.16, the direction the light travels) and the ambient
  are edited as the literal values the .LVL stores; OK hands them back, Cancel changes nothing.

    sun pad        a disc seen from above, N up and E right (+Z north, +X east, as the world view's
                   plan view draws them); the marker is where the sun SITS, (-X, -Z): screen
                   (-X, +Z down). Drag or click it, or the arrow keys (Shift: bigger steps).
                   The outer ring is a horizontal length of 65536.
    Y slider       0 .. -65536, the top is noon; a typed positive Y sits at the bottom.
    X Y Z Ambient  the exact values, committed on Enter or on leaving the box; an untouched box
                   never rewrites the vector.
    Keep strength  holds |v| at the strength captured when the dialog opens, Keep is turned on,
                   a preset is loaded, or the sun changes with Keep off (Traxx 7f4692a).
    presets        N, E, S, W, Noon load their vector verbatim, after a Yes / No question (6e4d82c);
                   a radio is checked only when the sun equals that preset exactly. A radio that
                   only gains focus (Tab, arrows) loads nothing (8f10fdd, 463d863).
    previews       the .LTE the bake will write, live (row z = 0 at the bottom: north up), and an
                   indicative cube with its shadow hull, faces lit by the engine's diffuse.

  Resizable; the pad takes 30% of the growth, the previews 35% each (CLightingDlg::Layout), and
  the size is remembered as Traxx's reg.lightingdlg_size is.
*/
import { el } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import { openDialog } from "../shell/dialog.ts";
import { makeResizable } from "./dialog-size.ts";
import {
  cubeShadowHull, engineLightCalcDiffuse, sunElevationDeg, sunIsTraxxDefault, sunKeepStrengthFromXZ, sunKeepStrengthFromY,
  sunMatchPreset, sunStrengthPct, SUN_PRESETS,
} from "../../core/edit/engine-light.ts";

export interface LightingValues {
  sun: [number, number, number];
  ambient: number;
}

export interface LightingDialogContext {
  app: AppState | null;
  /** The cells a side of the ground the bake makes (256, or 512 on a version 6 world). */
  cells: number;
  /** BakeEngineLighting for this sun and ambient into `out` (z * N + x). */
  bake: (sun: readonly number[], ambient: number, out: Uint8Array) => void;
}

/** YSLIDER_MAX: slider position p <-> Y = p - 65536. */
const YSLIDER_MAX = 65536;
const AMBIENT_MAX = 65535;
const PAD_FULL = 65536;
const PAD_MARGIN = 16;
const PAD_STEP = 256;
const PAD_STEP_BIG = 4096;
const INT_MAX = 2147483647, INT_MIN = -2147483648;
const LIGHTING_MIN = { w: 560, h: 420 };
const LIGHTING_FIRST = { w: 760, h: 480 };
const PRESET_NAMES = ["N", "E", "S", "W", "Noon"];

/** Which control a sync comes from (CLightingDlg's SRC_*). */
const Src = { Init: 0, Pad: 1, YSlider: 2, Edit: 3, Preset: 4, Ambient: 5, Keep: 6 } as const;
type Src = (typeof Src)[keyof typeof Src];

const stop = <T extends HTMLElement>(i: T) => { i.addEventListener("keydown", (e) => e.stopPropagation()); return i; };
const clampInt = (v: number) => (v > INT_MAX ? INT_MAX : v < INT_MIN ? INT_MIN : v);

export async function lightingDialog(start: LightingValues, ctx: LightingDialogContext): Promise<LightingValues | null> {
  const sun: [number, number, number] = [start.sun[0], start.sun[1], start.sun[2]];
  let ambient = start.ambient;
  let keep = true;
  let keepS = 65536;
  let navKey = false;
  let inPrompt = false;
  let inSync = false;
  // The remembered compass direction (x, z) for the Y slider: the incoming sun's, else the E preset's.
  const lastDir: [number, number] = sun[0] !== 0 || sun[2] !== 0 ? [sun[0], sun[2]] : [-1, 0];

  // ---- Controls.
  const pad = el("canvas", { class: "light-canvas light-pad", tabindex: 0, title: "Where the sun sits, seen from above (N up, E right). Drag, or use the arrow keys (Shift: bigger steps)." }) as HTMLCanvasElement;
  const ySlider = el("input", { type: "range", min: 0, max: YSLIDER_MAX, step: 1, class: "light-yslider", title: "The sun's height: the top is noon, the bottom the horizon" }) as HTMLInputElement;
  const terrain = el("canvas", { class: "light-canvas", title: "Baked terrain lighting (.LTE), as it will be written. In game, smooth terrain, shadows and detail relief add to this." }) as HTMLCanvasElement;
  const cube = el("canvas", { class: "light-canvas" }) as HTMLCanvasElement;
  const box = () => stop(el("input", { type: "text", class: "spin light-num", maxlength: 11, spellcheck: false }) as HTMLInputElement);
  const editX = box(), editY = box(), editZ = box(), editA = box();
  const edits = [editX, editY, editZ, editA];
  const keepBox = el("input", { type: "checkbox", checked: true }) as HTMLInputElement;
  const readout = el("span", { class: "light-line" });
  const ambSlider = el("input", { type: "range", min: 0, max: AMBIENT_MAX, step: 1, class: "light-aslider" }) as HTMLInputElement;
  const ambPct = el("span", { class: "light-pct" });
  const presets = PRESET_NAMES.map((n) => el("input", { type: "radio", value: n, "aria-label": n }) as HTMLInputElement);
  const defWarn = el("span", { class: "light-line light-warn" });

  // ---- The held strength (CaptureKeep): round(|sun|), 65536 for a zero sun, at least 1.
  function captureKeep(): void {
    const len = Math.sqrt(sun[0] * sun[0] + sun[1] * sun[1] + sun[2] * sun[2]);
    keepS = len < 0.5 ? 65536 : len >= INT_MAX ? INT_MAX : Math.floor(len + 0.5);
    if (keepS < 1) keepS = 1;
    drawPad();
  }

  // ---- ApplyY: Keep on rescales X/Z around the new Y; off sets Y alone.
  function applyY(y: number): void {
    if (y === sun[1]) return; // a click on the thumb that did not move it must not rescale X/Z
    if (keep) {
      // No horizontal part left (Y at the top): bring the remembered azimuth back.
      const from = sun[0] === 0 && sun[2] === 0 ? [lastDir[0], sun[1], lastDir[1]] : sun;
      const out = sunKeepStrengthFromY(from, y, keepS);
      sun[0] = out[0]; sun[1] = out[1]; sun[2] = out[2];
    } else {
      sun[1] = y;
      captureKeep();
    }
  }

  // ---- CommitEdit: an integer that differs from the current value is applied; anything else is put back.
  function commitEdit(input: HTMLInputElement): void {
    const text = input.value.trim();
    if (/^[+-]?\d+$/.test(text)) {
      const value = clampInt(Number(text));
      if (input === editX || input === editZ) {
        const which = input === editX ? 0 : 2;
        if (value !== sun[which]) {
          if (keep) {
            const out = which === 0 ? sunKeepStrengthFromXZ(value, sun[2], keepS) : sunKeepStrengthFromXZ(sun[0], value, keepS);
            sun[0] = out[0]; sun[1] = out[1]; sun[2] = out[2];
          } else {
            sun[which] = value;
            captureKeep();
          }
        }
      } else if (input === editY) {
        if (value !== sun[1]) applyY(value);
      } else ambient = value;
    }
    sync(Src.Edit);
  }

  // ---- The pad (CSunPadCtrl).
  const padGeometry = () => {
    const w = pad.clientWidth, h = pad.clientHeight;
    return { cx: Math.trunc(w / 2), cy: Math.trunc(h / 2), r: Math.max(Math.trunc(Math.min(w, h) / 2) - PAD_MARGIN, 4) };
  };
  function padApplyXZ(x: number, z: number): void {
    const old = [...sun];
    const len = Math.sqrt(x * x + z * z);
    if (len > PAD_FULL) {
      x = Math.floor((x / len) * PAD_FULL + 0.5);
      z = Math.floor((z / len) * PAD_FULL + 0.5);
    }
    if (keep) {
      const out = sunKeepStrengthFromXZ(x, z, keepS);
      sun[0] = out[0]; sun[1] = out[1]; sun[2] = out[2];
    } else { sun[0] = x; sun[2] = z; }
    if (old[0] !== sun[0] || old[1] !== sun[1] || old[2] !== sun[2]) {
      // OnSunPadChanged: a pad change with Keep off re-measures the held strength.
      if (!keep) captureKeep();
      sync(Src.Pad);
      drawPad();
    }
  }
  let dragging = false;
  const padPoint = (e: PointerEvent) => {
    const rect = pad.getBoundingClientRect();
    const { cx, cy, r } = padGeometry();
    const px = e.clientX - rect.left - cx, py = e.clientY - rect.top - cy;
    padApplyXZ(Math.floor((-px / r) * PAD_FULL + 0.5), Math.floor((py / r) * PAD_FULL + 0.5));
  };
  pad.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; pad.focus(); pad.setPointerCapture(e.pointerId); dragging = true; padPoint(e); });
  pad.addEventListener("pointermove", (e) => { if (dragging) padPoint(e); });
  const endDrag = () => { dragging = false; };
  pad.addEventListener("pointerup", endDrag);
  pad.addEventListener("lostpointercapture", endDrag);
  pad.addEventListener("focus", () => drawPad());
  pad.addEventListener("blur", () => drawPad());
  pad.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? PAD_STEP_BIG : PAD_STEP;
    const nudge = (v: number, d: number) => clampInt(v + d);
    // The arrows move the marker on screen: left = sun X up (the marker is at -X), up = Z down.
    const moves: Record<string, () => void> = {
      ArrowLeft: () => padApplyXZ(nudge(sun[0], step), sun[2]),
      ArrowRight: () => padApplyXZ(nudge(sun[0], -step), sun[2]),
      ArrowUp: () => padApplyXZ(sun[0], nudge(sun[2], -step)),
      ArrowDown: () => padApplyXZ(sun[0], nudge(sun[2], step)),
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    e.stopPropagation();
    move();
  });

  // ---- The sliders: the keyboard steps of Traxx's trackbars (line 256, page 4096).
  const sliderKeys = (input: HTMLInputElement, max: number, apply: (pos: number) => void) => input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    const pos = Number(input.value);
    const vertical = input === ySlider;
    const delta: Record<string, number> = {
      ArrowUp: vertical ? -256 : 256, ArrowDown: vertical ? 256 : -256, ArrowLeft: -256, ArrowRight: 256,
      PageUp: vertical ? -4096 : 4096, PageDown: vertical ? 4096 : -4096,
    };
    let next: number | null = null;
    if (e.key in delta) next = pos + delta[e.key]!;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = max;
    if (next === null) return;
    e.preventDefault();
    input.value = String(Math.max(0, Math.min(max, next)));
    apply(Number(input.value));
  });
  const onY = (pos: number) => {
    applyY(pos - YSLIDER_MAX);
    // A thumb dragged past -S (S under 100%) snaps back to where the clamped Y sits.
    if (keep) {
      const p = Math.max(0, Math.min(YSLIDER_MAX, sun[1] + YSLIDER_MAX));
      if (p !== Number(ySlider.value)) ySlider.value = String(p);
    }
    sync(Src.YSlider);
  };
  ySlider.addEventListener("input", () => onY(Number(ySlider.value)));
  sliderKeys(ySlider, YSLIDER_MAX, onY);
  const onAmbient = (pos: number) => { ambient = pos; sync(Src.Ambient); };
  ambSlider.addEventListener("input", () => onAmbient(Number(ambSlider.value)));
  sliderKeys(ambSlider, AMBIENT_MAX, onAmbient);

  // ---- The boxes: Enter commits (and selects the text) instead of pressing OK; leaving commits.
  for (const input of edits) {
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      commitEdit(input);
      input.select();
    });
    input.addEventListener("blur", () => commitEdit(input));
  }

  keepBox.addEventListener("change", () => {
    keep = keepBox.checked;
    captureKeep();
    sync(Src.Keep);
  });

  // ---- Presets: radios that never check themselves; a click asks, then sync shows the exact match.
  async function presetPrompt(message: string): Promise<boolean> {
    inPrompt = true;
    const r = await openDialog({
      title: "Lighting",
      body: el("p", { class: "modal-text" }, message),
      buttons: [{ label: "Yes", value: "yes" }, { label: "No", value: "no", primary: true }],
    });
    inPrompt = false;
    pad.focus();
    return r === "yes";
  }
  presets.forEach((radio, i) => radio.addEventListener("click", (e) => {
    e.preventDefault();
    if (navKey || inPrompt) return;
    void (async () => {
      // After the click's own revert of the checked state (a cancelled click's activation runs after the
      // listeners and their microtasks), so sync's checks are the ones that stay.
      await new Promise((r) => setTimeout(r, 0));
      const p = SUN_PRESETS[i]!;
      if (sun[0] !== p[0] || sun[1] !== p[1] || sun[2] !== p[2]) {
        const msg = `Reset the sun position to the ${PRESET_NAMES[i]} preset?\n\nX, Y, Z become ${p[0]}, ${p[1]}, ${p[2]} (currently ${sun[0]}, ${sun[1]}, ${sun[2]}). Ambient is not changed.`;
        if (await presetPrompt(msg)) {
          sun[0] = p[0]; sun[1] = p[1]; sun[2] = p[2];
          captureKeep(); // the preset's own strength (Noon holds 97.7%)
        }
      }
      sync(Src.Preset);
    })();
  }));

  // ---- Sync: every control, readout, warning and preview follows sun and ambient.
  const setEdit = (input: HTMLInputElement, value: number) => { const want = String(value); if (input.value !== want) input.value = want; };
  function sync(source: Src): void {
    if (inSync) return;
    inSync = true;
    if (sun[0] !== 0 || sun[2] !== 0) { lastDir[0] = sun[0]; lastDir[1] = sun[2]; }
    if (source !== Src.Pad) drawPad();
    if (source !== Src.YSlider) ySlider.value = String(Math.max(0, Math.min(YSLIDER_MAX, sun[1] + YSLIDER_MAX)));
    setEdit(editX, sun[0]); setEdit(editY, sun[1]); setEdit(editZ, sun[2]); setEdit(editA, ambient);
    if (source !== Src.Ambient) ambSlider.value = String(Math.max(0, Math.min(AMBIENT_MAX, ambient)));
    ambPct.textContent = `${Math.trunc((ambient * 100 + (ambient < 0 ? -32768 : 32768)) / 65536)}%`;
    const match = sunMatchPreset(sun);
    presets.forEach((r, i) => { r.checked = i === match; });
    const strength = keep ? (100 * keepS) / 65536 : sunStrengthPct(sun);
    let s = `elev ${sunElevationDeg(sun).toFixed(1)}°  strength ${strength.toFixed(1)}%${keep ? " (held)" : ""}`;
    if (sun[1] >= 0) s += "  -  sun below horizon";
    if (strength > 100.01) s += "  -  strength over 100%";
    if (ambient < 0 || ambient > AMBIENT_MAX) s += "  -  ambient out of range";
    readout.textContent = s;
    defWarn.textContent = sunIsTraxxDefault(sun, ambient) ? "Warning: sun and ambient equal Traxx's defaults, not values from this track." : "";
    schedulePreviews();
    inSync = false;
  }

  // ---- Drawing.
  const css = (name: string, fallback: string) => getComputedStyle(pad).getPropertyValue(name).trim() || fallback;
  /** A canvas sized to its box in device pixels; the context draws in CSS pixels. */
  function prepare(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w <= 0 || h <= 0) return null;
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return g;
  }

  function drawPad(): void {
    const g = prepare(pad);
    if (!g) return;
    const { cx, cy, r } = padGeometry();
    const ring = (radius: number) => { g.beginPath(); g.arc(cx + 0.5, cy + 0.5, radius, 0, 2 * Math.PI); };
    ring(r);
    g.fillStyle = "rgb(246, 246, 246)";
    g.fill();
    g.strokeStyle = "rgb(200, 200, 200)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx - r, cy + 0.5); g.lineTo(cx + r + 1, cy + 0.5);
    g.moveTo(cx + 0.5, cy - r); g.lineTo(cx + 0.5, cy + r + 1);
    g.stroke();
    // Faint 30 and 60 degree elevation rings, only meaningful while the strength is kept.
    if (keep) {
      g.save();
      g.setLineDash([1, 2]);
      g.strokeStyle = "rgb(170, 170, 170)";
      for (const deg of [30, 60]) {
        const rr = Math.floor((keepS * Math.cos((deg * Math.PI) / 180)) / PAD_FULL * r + 0.5);
        if (rr > 1 && rr <= r) { ring(rr); g.stroke(); }
      }
      g.restore();
    }
    ring(r);
    g.strokeStyle = "rgb(110, 110, 110)";
    g.stroke();
    // The compass: +Z (N) is screen up, +X (E) screen right.
    g.fillStyle = css("--text", "#1d1d1b");
    g.font = "11px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("N", cx, cy - r - PAD_MARGIN / 2);
    g.fillText("S", cx, cy + r + PAD_MARGIN / 2);
    g.fillText("E", cx + r + PAD_MARGIN / 2, cy);
    g.fillText("W", cx - r - PAD_MARGIN / 2, cy);
    // The marker: where the sun sits, screen (-X, +Z).
    const mx = cx + Math.floor((-sun[0] / PAD_FULL) * r + 0.5);
    const my = cy + Math.floor((sun[2] / PAD_FULL) * r + 0.5);
    g.strokeStyle = "rgb(200, 140, 0)";
    g.beginPath(); g.moveTo(cx + 0.5, cy + 0.5); g.lineTo(mx + 0.5, my + 0.5); g.stroke();
    g.beginPath(); g.arc(mx + 0.5, my + 0.5, 6, 0, 2 * Math.PI);
    g.fillStyle = "rgb(255, 205, 40)"; g.fill();
    g.strokeStyle = "rgb(90, 60, 0)"; g.stroke();
    if (document.activeElement === pad) {
      g.save();
      g.setLineDash([1, 1]);
      g.strokeStyle = css("--text", "#1d1d1b");
      g.strokeRect(1.5, 1.5, pad.clientWidth - 3, pad.clientHeight - 3);
      g.restore();
    }
  }

  // The terrain preview: the bake into a scratch buffer, grey, row z = 0 at the bottom (north up).
  const n = ctx.cells;
  const ground = new Uint8Array(n * n);
  const image = new ImageData(n, n);
  const scratch = new OffscreenCanvas(n, n);
  function drawTerrain(): void {
    ctx.bake(sun, ambient, ground);
    const px = image.data;
    for (let z = 0; z < n; z++) {
      const row = (n - 1 - z) * n;
      for (let x = 0; x < n; x++) {
        const v = ground[z * n + x]!, o = (row + x) * 4;
        px[o] = px[o + 1] = px[o + 2] = v;
        px[o + 3] = 255;
      }
    }
    scratch.getContext("2d")!.putImageData(image, 0, 0);
    const g = prepare(terrain);
    if (!g) return;
    const w = terrain.clientWidth, h = terrain.clientHeight;
    const side = Math.min(w, h);
    const left = Math.trunc((w - side) / 2), top = Math.trunc((h - side) / 2);
    // Halftone (smoothed) when it shrinks, plain pixels when it grows, as Traxx's StretchDIBits.
    g.imageSmoothingEnabled = side < n;
    g.drawImage(scratch, left, top, side, side);
    g.strokeStyle = "rgb(80, 80, 80)";
    g.strokeRect(left + 0.5, top + 0.5, side - 1, side - 1);
  }

  // The cube preview (CCubeLightPreview): from the south-east, 35 degrees up; ground -1.5..2.5.
  const EL = (35 * Math.PI) / 180, R2 = Math.SQRT1_2;
  const project = (x: number, y: number, z: number): [number, number] => {
    const far = (z - x) * R2;
    return [(x + z) * R2, y * Math.cos(EL) + far * Math.sin(EL)];
  };
  const FACES: { n: [number, number, number]; c: [number, number, number][] }[] = [
    { n: [0, 65535, 0], c: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] }, // top
    { n: [65535, 0, 0], c: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]] }, // east
    { n: [0, 0, -65535], c: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] }, // south
  ];
  function drawCube(): void {
    const g = prepare(cube);
    if (!g) return;
    const w = cube.clientWidth, h = cube.clientHeight;
    g.font = "11px system-ui, sans-serif";
    const capH = 14;
    const scene = { left: 6, top: 6, w: w - 12, h: h - capH - 4 - 12 };
    const gx = [-1.5, 2.5, 2.5, -1.5], gz = [-1.5, -1.5, 2.5, 2.5];
    const gp = gx.map((x, i) => project(x, 0, gz[i]!));
    let minr = Infinity, maxr = -Infinity, minu = Infinity, maxu = -Infinity;
    for (const [r, u] of gp) { minr = Math.min(minr, r); maxr = Math.max(maxr, r); minu = Math.min(minu, u); maxu = Math.max(maxu, u); }
    maxu = Math.max(maxu, project(0, 1, 1)[1], project(1, 1, 1)[1]);
    const sw = maxr - minr, sh = maxu - minu;
    const scale = Math.max(1, Math.min(scene.w / sw, scene.h / sh));
    const offx = scene.left + (scene.w - sw * scale) / 2 - minr * scale;
    const offy = scene.top + (scene.h - sh * scale) / 2 + maxu * scale;
    const PX = (r: number) => Math.floor(offx + r * scale + 0.5) + 0.5;
    const PY = (u: number) => Math.floor(offy - u * scale + 0.5) + 0.5;
    const poly = (pts: [number, number][]) => { g.beginPath(); pts.forEach(([r, u], i) => (i ? g.lineTo(PX(r), PY(u)) : g.moveTo(PX(r), PY(u)))); g.closePath(); };

    // Ground.
    poly(gp);
    g.fillStyle = "rgb(214, 214, 214)"; g.fill();
    g.strokeStyle = "rgb(120, 120, 120)"; g.lineWidth = 1; g.stroke();
    // The shadow before the cube, clipped to the ground (a low sun throws it a long way).
    const hull = cubeShadowHull(sun);
    if (hull.length >= 3) {
      g.save();
      poly(gp); g.clip();
      poly(hull.map(([x, z]) => project(x, 0, z)));
      g.fillStyle = g.strokeStyle = "rgb(128, 128, 128)";
      g.fill(); g.stroke();
      g.restore();
    }
    // The three visible faces, each grey by the engine's diffuse for its normal.
    g.strokeStyle = "rgb(40, 40, 40)";
    for (const f of FACES) {
      let bright = (engineLightCalcDiffuse(sun, ambient, f.n) - 0x100) * 16;
      bright = Math.max(0, Math.min(65535, bright));
      const v = Math.trunc((bright * 255) / 65535);
      poly(f.c.map(([x, y, z]) => project(x, y, z)));
      g.fillStyle = `rgb(${v}, ${v}, ${v})`; g.fill(); g.stroke();
    }
    // A small compass in the top-left corner: the ground's N/E/S/W as the camera sees them.
    const ccx = 30, ccy = 30, arm = 20;
    g.strokeStyle = "rgb(100, 100, 100)";
    g.fillStyle = css("--text", "#1d1d1b");
    g.textAlign = "center"; g.textBaseline = "middle";
    for (const [s, x, z] of [["N", 0, 1], ["E", 1, 0], ["S", 0, -1], ["W", -1, 0]] as const) {
      const [r, u] = project(x, 0, z);
      g.beginPath(); g.moveTo(ccx + 0.5, ccy + 0.5); g.lineTo(ccx + Math.floor(r * arm + 0.5) + 0.5, ccy - Math.floor(u * arm + 0.5) + 0.5); g.stroke();
      g.fillText(s, ccx + Math.floor(r * (arm + 9) + 0.5), ccy - Math.floor(u * (arm + 9) + 0.5));
    }
    g.fillStyle = css("--text-dim", "#6b6a66");
    g.fillText("Indicative - not the engine's GPU shadow", w / 2, h - capH / 2 - 2, w - 4);
  }

  // The previews follow at most once a frame (a pad drag bakes the whole ground).
  let frame = 0;
  function schedulePreviews(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; drawTerrain(); drawCube(); });
  }

  // ---- Layout.
  const cell = (cls: string, ...kids: HTMLElement[]) => el("div", { class: `light-cell ${cls}` }, ...kids);
  const label = (text: string, input: HTMLInputElement) => el("label", { class: "light-field" }, text, input);
  const body = el("div", { class: "light" },
    el("div", { class: "light-top" },
      cell("light-cell-pad", pad),
      el("div", { class: "light-ycell" }, ySlider),
      cell("light-cell-view", terrain),
      cell("light-cell-view", cube)),
    el("div", { class: "opt-row" },
      label("X", editX), label("Y", editY), label("Z", editZ),
      el("label", { class: "opt-check" }, keepBox, "Keep strength")),
    readout,
    el("div", { class: "light-amb" }, label("Ambient", editA), ambSlider, ambPct),
    el("fieldset", { class: "opt-group light-presets" }, el("legend", {}, "Sun preset"),
      ...presets.map((r, i) => el("label", { class: "opt-check" }, r, PRESET_NAMES[i]!))),
    defWarn);

  // A Tab or arrow keydown is a focus change, never a preset click (8f10fdd).
  body.addEventListener("keydown", (e) => {
    if (["Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      navKey = true;
      setTimeout(() => { navKey = false; }, 0);
    }
  }, { capture: true });

  const shown = openDialog({
    title: "Lighting",
    body,
    className: "light-dialog",
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    // OnOK: a box still being typed in is committed first.
    beforeClose: (value) => {
      if (value === "ok") for (const input of edits) if (document.activeElement === input) commitEdit(input);
      return true;
    },
  });
  const dialog = body.closest("dialog");
  if (dialog && ctx.app) makeResizable(dialog, ctx.app, "Lighting Size", LIGHTING_MIN, LIGHTING_FIRST, body);
  const resize = new ResizeObserver(() => { drawPad(); schedulePreviews(); });
  for (const c of [pad, terrain, cube]) resize.observe(c);

  captureKeep();
  sync(Src.Init);
  const r = await shown;
  resize.disconnect();
  if (frame) cancelAnimationFrame(frame);
  if (r !== "ok") return null;
  return { sun: [sun[0], sun[1], sun[2]], ambient };
}

