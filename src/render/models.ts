/*
  Models and their textures for the view: each .BIN's geometry once (core/view/model-geometry),
  and each model texture as Traxx shows it: remapped into the track palette with the gamma
  (or its HD image, its alpha dropped as Traxx's HD decode drops it).

  Model Transparency (Options) is Traxx's settransparency: with it on, cutout faces (types
  0x11 and 0x33) have their black texels punched through (COpenGLTerrainRenderer::
  GetTextureAlpha: MTM2 cuts index 0, which Traxx tests as black); with it off, the default,
  every face is drawn solid, holes and all. Nothing is ever drawn see-through.
*/
import * as THREE from "three";
import type { TrackDocument, ModelAsset } from "../core/doc/document.ts";
import { modelGeometry, type ModelGeometry } from "../core/view/model-geometry.ts";
import { gammaMap, legacyTileRgba, type RgbaImage } from "../core/view/tiles.ts";
import { findModelTexture } from "../core/doc/load-pod.ts";
import { afterFirstSlash } from "../core/doc/names.ts";
import { decodeHd } from "./hd-decode.ts";

export interface ModelMeshes {
  geometry: ModelGeometry;
  /** One geometry and material per face group. */
  parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[];
}

export class ModelLibrary {
  private doc: TrackDocument;
  private gamma: number;
  private textures = new Map<string, THREE.DataTexture>();
  private hd: Map<number, RgbaImage>;
  private meshes = new Map<string, ModelMeshes | null>();
  private materials: THREE.Material[] = [];
  transparency = false;

  /** `hd` holds decoded HD images by model texture index, kept by the caller across rebuilds. */
  constructor(doc: TrackDocument, gamma: number, hd: Map<number, RgbaImage> = new Map()) {
    this.doc = doc;
    this.gamma = gamma;
    this.hd = hd;
  }

  /** Decode the HD art of model textures not decoded yet into the shared map; true when there was any. */
  async loadHd(): Promise<boolean> {
    const jobs = this.doc.modelTextures.map((t, i) => (t.hd && !this.hd.has(i) ? decodeHd(t.hd).then((img) => { if (img) this.hd.set(i, opaque(img)); }) : null)).filter(Boolean);
    await Promise.all(jobs);
    return jobs.length > 0;
  }

  /** The model asset for a name as boxes record it ("STLITE.BIN"), or null. */
  asset(name: string): ModelAsset | null {
    if (!name) return null;
    const key = afterFirstSlash(name);
    return this.doc.models.find((m) => afterFirstSlash(m.name) === key && m.bytes) ?? null;
  }

  /** A model's meshes, built once; null when it cannot be drawn. */
  meshesFor(name: string): ModelMeshes | null {
    const key = afterFirstSlash(name);
    if (this.meshes.has(key)) return this.meshes.get(key)!;
    const asset = this.asset(name);
    let result: ModelMeshes | null = null;
    const geometry = asset?.bytes ? modelGeometry(asset.bytes) : null;
    if (geometry) {
      const parts = geometry.groups.map((g) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(g.positions, 3));
        geo.setAttribute("uv", new THREE.BufferAttribute(g.uvs, 2));
        geo.computeBoundingSphere();
        return { geometry: geo, material: this.material(g.textureName, g.cutout, g.color, g.twoSided) };
      });
      result = { geometry, parts };
    }
    this.meshes.set(key, result);
    return result;
  }

  private material(textureName: string, cutout: boolean, color: number | null, twoSided: boolean): THREE.Material {
    // BackSide: a BIN's front faces wind clockwise in these axes (model-geometry.ts).
    const common = { side: twoSided ? THREE.DoubleSide : THREE.BackSide };
    cutout = cutout && this.transparency;
    let m: THREE.Material;
    if (color !== null || !textureName) {
      const g = gammaMap(this.gamma);
      const c = color ?? 0x808080;
      m = new THREE.MeshBasicMaterial({ ...common, color: new THREE.Color(g[(c >> 16) & 255] / 255, g[(c >> 8) & 255] / 255, g[c & 255] / 255) });
    } else {
      const map = this.texture(textureName, cutout);
      m = new THREE.MeshBasicMaterial({ ...common, map, alphaTest: cutout ? 0.5 : 0, color: map ? 0xffffff : 0x606060 });
    }
    this.materials.push(m);
    return m;
  }

  private texture(name: string, cutout: boolean): THREE.DataTexture | null {
    const key = `${name}|${cutout}`;
    if (this.textures.has(key)) return this.textures.get(key)!;
    const list = this.doc.modelTextures;
    const at = findModelTexture(list, name.includes("\\") ? name : `ART\\${name}`);
    let image: RgbaImage | null = null;
    if (at >= 0) {
      const tex = list[at];
      const legacy = legacyTileRgba(tex, this.doc.track.palette, gammaMap(this.gamma));
      const hd = this.hd.get(at) ?? null;
      image = hd ?? legacy;
      if (image && cutout && legacy) image = cutoutImage(image, legacy);
    }
    if (!image) { this.textures.set(key, null as unknown as THREE.DataTexture); return null; }
    const t = new THREE.DataTexture(new Uint8Array(image.rgba), image.width, image.height, THREE.RGBAFormat);
    t.colorSpace = THREE.NoColorSpace;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapNearestFilter;
    t.generateMipmaps = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    this.textures.set(key, t);
    return t;
  }

  dispose(): void {
    for (const t of this.textures.values()) t?.dispose();
    for (const m of this.materials) m.dispose();
    for (const mm of this.meshes.values()) mm?.parts.forEach((p) => p.geometry.dispose());
  }
}

/* MTM2 has no alpha channel: an HD image's alpha is ignored. */
function opaque(image: RgbaImage): RgbaImage {
  const rgba = new Uint8Array(image.rgba);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return { width: image.width, height: image.height, rgba };
}

/*
  The cutout comes from the legacy tile, never the HD image: a texel is a hole where the
  8-bit page is black, sampled at the scaled position; a hole keeps black RGB.
*/
function cutoutImage(image: RgbaImage, legacy: RgbaImage): RgbaImage {
  const out = new Uint8Array(image.rgba);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const ix = Math.trunc((x * legacy.width) / image.width), iy = Math.trunc((y * legacy.height) / image.height);
      const s = (iy * legacy.width + ix) * 4, d = (y * image.width + x) * 4;
      if (legacy.rgba[s] === 0 && legacy.rgba[s + 1] === 0 && legacy.rgba[s + 2] === 0) out.set([0, 0, 0, 0], d);
    }
  }
  return { width: image.width, height: image.height, rgba: out };
}
