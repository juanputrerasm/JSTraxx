/*
  The water (COpenGLTerrainRenderer::DrawWaterTiled, DrawWaterFill), at ALTITUDESCALE x the
  level in quarter steps / 4:

    - the line grid: the outline of every cell whose four corners are all under the water, in
      palette entry 252;
    - the see-through fill: a quad over every cell with any corner under it, (30, 100, 200) at
      the Options > Advanced opacity, drawn after the objects, depth-tested but not written.

  Both are clipped to the grid window like the terrain.
*/
import * as THREE from "three";
import { ALTITUDE_SCALE } from "../core/view/camera.ts";

const vertexShader = /* glsl */ `
  in vec3 position;
  in vec2 cell;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  flat out vec2 vCell;
  void main() { vCell = cell; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform vec4 window;
  uniform vec3 colour;
  uniform float opacity;
  flat in vec2 vCell;
  out vec4 outColor;
  void main() {
    if (vCell.x < window.x || vCell.y < window.y || vCell.x >= window.z || vCell.y >= window.w) discard;
    outColor = vec4(colour, opacity);
  }
`;

function windowed(colour: THREE.Color, opacity: number, transparent: boolean): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader, fragmentShader, transparent, depthWrite: !transparent,
    side: THREE.DoubleSide,
    uniforms: { window: { value: new THREE.Vector4(0, 0, 256, 256) }, colour: { value: colour }, opacity: { value: opacity } },
  });
}

export class WaterLayer {
  readonly group = new THREE.Group();
  readonly lineMaterial = windowed(new THREE.Color(0, 0, 1), 1, false);
  readonly fillMaterial = windowed(new THREE.Color(30 / 255, 100 / 255, 200 / 255), 0.5, true);
  private lines = new THREE.LineSegments(new THREE.BufferGeometry(), this.lineMaterial);
  private fill = new THREE.Mesh(new THREE.BufferGeometry(), this.fillMaterial);

  constructor() {
    this.fill.renderOrder = 10;
    this.lines.frustumCulled = this.fill.frustumCulled = false;
    this.group.add(this.lines, this.fill);
  }

  rebuild(heights: Uint8Array, level4: number): void {
    const z = (ALTITUDE_SCALE * level4) / 4;
    const lp: number[] = [], lc: number[] = [], fp: number[] = [], fc: number[] = [];
    if (level4 > 0) {
      for (let j = 0; j < 255; j++) {
        for (let i = 0; i < 255; i++) {
          const under = [heights[i + (j << 8)], heights[i + 1 + (j << 8)], heights[i + 1 + ((j + 1) << 8)], heights[i + ((j + 1) << 8)]].map((h) => 4 * h < level4);
          const x0 = i * 64, y0 = j * 64, x1 = x0 + 64, y1 = y0 + 64;
          if (under.every(Boolean)) {
            lp.push(x0, y0, z, x1, y0, z, x1, y0, z, x1, y1, z, x1, y1, z, x0, y1, z, x0, y1, z, x0, y0, z);
            for (let k = 0; k < 8; k++) lc.push(i, j);
          }
          if (under.some(Boolean)) {
            fp.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z);
            for (let k = 0; k < 6; k++) fc.push(i, j);
          }
        }
      }
    }
    const set = (obj: THREE.LineSegments | THREE.Mesh, p: number[], c: number[]) => {
      obj.geometry.dispose();
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute("cell", new THREE.Float32BufferAttribute(c, 2));
      obj.geometry = g;
    };
    set(this.lines, lp, lc);
    set(this.fill, fp, fc);
  }

  setWindow(w: THREE.Vector4): void {
    this.lineMaterial.uniforms.window.value.copy(w);
    this.fillMaterial.uniforms.window.value.copy(w);
  }

  /** Line colour: palette entry 252 with the gamma; fill opacity in percent; no fill over a wire frame. */
  setLook(lineRgb: [number, number, number], opacity: number, fill: boolean): void {
    this.lineMaterial.uniforms.colour.value.setRGB(lineRgb[0] / 255, lineRgb[1] / 255, lineRgb[2] / 255);
    this.fillMaterial.uniforms.opacity.value = Math.round((Math.min(100, opacity) * 255 + 50) / 100) / 255;
    this.fill.visible = fill && opacity > 0;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.fill.geometry.dispose();
    this.lineMaterial.dispose();
    this.fillMaterial.dispose();
  }
}
