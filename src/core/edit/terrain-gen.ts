/*
  Generate Terrain (Traxx/TerrainGenDlg.cpp OnGenRebuild), with MSVC's srand/rand so a seed
  makes the terrain Traxx makes.

    Classic  the ground level, then 40 + (100 - smoothness) * 4096 / 100 boxes, each raised by
             up to the hill height or sunk by up to the valley depth (clamped 1..255)
    Fractal  diamond-square from zero; "Max range" sets how fast the noise falls off and
             "Roughness" scales it around 127

  Then smoothing passes in place, each cell the mean of itself and its east, south and
  south-east neighbours (wrapping): 12 + 30 * smoothness / 100 passes for Classic,
  smoothness / 5 for Fractal.
*/

/** MSVC's rand(): holdrand = holdrand * 214013 + 2531011, the high 15 bits. */
export class MsvcRand {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0; }
  next(): number {
    this.state = (Math.imul(this.state, 214013) + 2531011) >>> 0;
    return (this.state >>> 16) & 0x7fff;
  }
}

export interface TerrainGenSettings {
  /** 0 Classic, 1 Fractal. */
  mode: number;
  seed: number;
  ground: number;
  hillHeight: number;
  valleyDepth: number;
  smoothness: number;
}

const f32 = Math.fround;

function fractalRecurse(fred: Float32Array, i: number, j: number, spacing: number, range: number, rand: MsvcRand): void {
  if (spacing < 2) return;
  const half = spacing >> 1, pitch = 255, at = (x: number, y: number) => x + (pitch + 1) * y;
  let ii = i, jj = j;
  const v1 = fred[at(ii, jj)]!;
  ii = (i + spacing) & pitch;
  const v2 = fred[at(ii, jj)]!;
  jj = (j + spacing) & pitch;
  const v3 = fred[at(ii, jj)]!;
  ii = i;
  const v4 = fred[at(ii, jj)]!;
  fred[at(i + half, j + half)] = f32(f32(f32(f32(f32(v1 + v2) + v3) + v4) / 4) + f32(range * ((rand.next() & 255) - 127)));
  for (let k = 0; k < 4; k++) {
    const [u, v] = k === 0 ? [i + half, j] : k === 1 ? [i, j + half] : k === 2 ? [i + spacing, j + half] : [i + half, j + spacing];
    let y = v & pitch;
    let x = (u - half) & pitch;
    const a = fred[at(x, y)]!;
    x = (u + half) & pitch;
    const b = fred[at(x, y)]!;
    x = u & pitch;
    y = (v - half) & pitch;
    const c = fred[at(x, y)]!;
    y = (v + half) & pitch;
    const d = fred[at(x, y)]!;
    fred[at(u & pitch, v & pitch)] = f32(f32(f32(f32(f32(a + b) + c) + d) / 4) + f32(range * ((rand.next() & 255) - 127)));
  }
}

export function generateTerrain(s: TerrainGenSettings): Uint8Array {
  const rand = new MsvcRand(s.seed);
  const terrain = new Uint8Array(65536);
  if (s.mode === 0) {
    terrain.fill(s.ground);
    const nhills = 40 + Math.trunc(((100 - s.smoothness) * 4096) / 100);
    const hillsize = 4 + Math.trunc((s.smoothness * 32) / 100);
    for (let n = 0; n < nhills; n++) {
      const x = rand.next() & 255, y = rand.next() & 255;
      const w = Math.trunc((hillsize * (rand.next() & 4095)) / 4096);
      const h = Math.trunc((hillsize * (rand.next() & 4095)) / 4096);
      const hz = Math.trunc((s.hillHeight * (rand.next() & 4095)) / 4096);
      const vz = Math.trunc((s.valleyDepth * (rand.next() & 4095)) / 4096);
      const up = (rand.next() & 1) !== 0;
      for (let j = y; j < y + h; j++) {
        for (let i = x; i < x + w; i++) {
          const c = (i & 255) + ((j & 255) << 8);
          terrain[c] = Math.max(1, Math.min(255, terrain[c]! + (up ? hz : -vz)));
        }
      }
    }
  } else {
    const h = (255 - s.hillHeight) / 255;
    const relax = f32(Math.pow(2, -h));
    const src = new Float32Array(65536);
    let spacing = 256;
    let range = f32(1);
    while (spacing >= 2) {
      for (let j = 0; j < 256; j += spacing) for (let i = 0; i < 256; i += spacing) fractalRecurse(src, i, j, spacing, range, rand);
      spacing >>= 1;
      range = f32(range * relax);
    }
    for (let p = 0; p < 65536; p++) {
      const value = f32(f32(f32(src[p]! * s.valleyDepth) / 256) + 127);
      terrain[p] = value <= 0 ? 0 : value >= 255 ? 255 : Math.trunc(value);
    }
  }
  const passes = s.mode === 0 ? 12 + Math.trunc((30 * s.smoothness) / 100) : Math.trunc(s.smoothness / 5);
  for (let n = 0; n < passes; n++) {
    for (let i = 0; i < 65536; i++) {
      terrain[i] = (terrain[i]! + terrain[(i + 1) & 65535]! + terrain[(i + 256) & 65535]! + terrain[(i + 257) & 65535]!) >> 2;
    }
  }
  return terrain;
}
