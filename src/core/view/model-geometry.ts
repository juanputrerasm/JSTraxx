/*
  A .BIN model as Traxx draws it, in Traxx's scene units (ipos across, ALTITUDESCALE units up).

  CTrackPODModel::Load reads a vertex as x = word0 >> 1, up = word1 >> 1, north = word2 >> 1,
  at 128 units a foot, and ignores MRGL_MAGNIFY; BuildModelPolyobj then divides by 64. Traxx
  rounds there to whole units because its polygon library holds integers (its own note calls
  the wireframe the accurate one); this keeps full precision.

  The up axis is left unscaled here: the object transform applies Traxx's ZStretch(768)
  (objectMatrix), and the backdrop takes none.

  Faces are fans, grouped by texture and by whether index 0 cuts out (face types 0x11 and
  0x33, "transparent"); solid faces (0x19) carry their colour.

  Faces are one-sided, as the game culls them (and as JSPod and JSTrackViewer draw them): a
  sign's front and back are two faces in the same plane, told apart only by their winding, so
  drawing both sides lets the back cover the front. A face whose material carries
  MRGLMAT_TWOSIDED is drawn from both sides. Traxx draws every face from both sides.
*/
import { parseBin } from "../../vendor/openphotex/model/bin.js";

const UV_SCALE = 0xff0000;
const CUTOUT = new Set([0x11, 0x33]);
const SOLID = 0x19;
const MRGLMAT_TWOSIDED = 0x0080;

export interface ModelGroup {
  /** The texture name the faces record, upper case; "" for solid colour. */
  textureName: string;
  cutout: boolean;
  /** Drawn from both sides (MRGLMAT_TWOSIDED); otherwise only from the front. */
  twoSided: boolean;
  /** 0xRRGGBB for a solid group. */
  color: number | null;
  positions: Float32Array;
  uvs: Float32Array;
}

export interface ModelGeometry {
  groups: ModelGroup[];
  /** Vertices in scene units (unstretched), for the wireframe and the arena anchor. */
  vertices: Float32Array;
  /** Raw (word >> 1) coordinates, for rules that work in Traxx's model units. */
  raw: Int32Array;
  /** Animated BIN: its frame models. */
  frameNames: string[];
  /** Every face's outline as line segments (pairs of points), unstretched, for the selection overlay. */
  outlines: Float32Array;
  /** The BIN's polygon count (CountPolygons), for the Models window. */
  polygons: number;
}

export function modelGeometry(bytes: Uint8Array): ModelGeometry | null {
  const bin = parseBin(bytes);
  if (bin.kind === "animated") return { groups: [], vertices: new Float32Array(), raw: new Int32Array(), frameNames: bin.frameNames, outlines: new Float32Array(), polygons: 0 };
  if (bin.kind !== "mrgl" || !bin.vertexListValid) return null;
  const w = bin.vertices;
  const count = w.length / 3;
  const raw = new Int32Array(count * 3);
  const vertices = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = w[i * 3] >> 1, up = w[i * 3 + 1] >> 1, north = w[i * 3 + 2] >> 1;
    raw.set([x, north, up], i * 3);
    vertices.set([x / 64, north / 64, up / 64], i * 3);
  }
  const groups = new Map<string, { textureName: string; cutout: boolean; twoSided: boolean; color: number | null; p: number[]; uv: number[] }>();
  const outline: number[] = [];
  for (const face of bin.faces) {
    const idx = face.vertexIndices;
    if (!idx || idx.length < 3 || idx.some((n) => n >= count)) continue;
    const solid = face.opcode === SOLID || !face.textureName;
    const textureName = solid ? "" : face.textureName.toUpperCase();
    const cutout = !solid && CUTOUT.has(face.opcode);
    const color = solid ? (face.solidColor >>> 0) & 0xffffff : null;
    const twoSided = face.material !== null && Boolean((bin.materials[face.material]?.flags ?? 0) & MRGLMAT_TWOSIDED);
    const key = `${solid ? `#${color}` : `${textureName}|${cutout ? 1 : 0}`}|${twoSided ? 2 : 1}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { textureName, cutout, twoSided, color, p: [], uv: [] }));
    for (let k = 0; k < idx.length; k++) {
      const a = idx[k], b = idx[(k + 1) % idx.length];
      outline.push(vertices[a * 3], vertices[a * 3 + 1], vertices[a * 3 + 2], vertices[b * 3], vertices[b * 3 + 1], vertices[b * 3 + 2]);
    }
    for (let t = 1; t < idx.length - 1; t++) {
      for (const k of [0, t, t + 1]) {
        const n = idx[k];
        g.p.push(vertices[n * 3], vertices[n * 3 + 1], vertices[n * 3 + 2]);
        g.uv.push((face.u[k] ?? 0) / UV_SCALE, (face.v[k] ?? 0) / UV_SCALE);
      }
    }
  }
  return {
    groups: [...groups.values()].filter((g) => g.p.length).map((g) => ({
      textureName: g.textureName, cutout: g.cutout, twoSided: g.twoSided, color: g.color, positions: new Float32Array(g.p), uvs: new Float32Array(g.uv),
    })),
    vertices, raw, frameNames: [], outlines: new Float32Array(outline), polygons: bin.faces.length,
  };
}

/** Traxx's object Z stretch: 768 / 1024 (TRAXX_GL_OBJECT_ZSTRETCH). */
export const OBJECT_ZSTRETCH = 768 / 1024;

/*
  Where Traxx draws a box (CalculateBoxLocationsOpenGL, NativeObjectStackLinear): rotate by Y
  through -phi, X through -theta, Z through -psi (right-handed, z up), squash z by 768/1024,
  then move to ipos + fraction / 256, with z = ALTITUDESCALE * (ipos[2] + zfraction / 256).
  Returned as a column-major 4x4 matrix.
*/
export function objectMatrix(box: { ipos: [number, number, number]; fraction: [number, number, number]; theta: number; phi: number; psi: number }, zstretch = OBJECT_ZSTRETCH): number[] {
  const cy = Math.cos(-box.phi), sy = Math.sin(-box.phi);
  const cx = Math.cos(-box.theta), sx = Math.sin(-box.theta);
  const cz = Math.cos(-box.psi), sz = Math.sin(-box.psi);
  // R = Rz * Rx * Ry
  const ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  const rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  const mul = (a: number[][], b: number[][]) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
  const r = mul(rz, mul(rx, ry));
  // Squash the world z after rotating.
  r[2] = r[2].map((v) => v * zstretch);
  const tx = box.ipos[0] + box.fraction[0] / 256;
  const ty = box.ipos[1] + box.fraction[1] / 256;
  const tz = 3 * (box.ipos[2] + box.fraction[2] / 256);
  return [r[0][0], r[1][0], r[2][0], 0, r[0][1], r[1][1], r[2][1], 0, r[0][2], r[1][2], r[2][2], 0, tx, ty, tz, 1];
}
