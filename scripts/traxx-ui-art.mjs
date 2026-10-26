/*
  Converts Traxx's own toolbar strips and icons (Traxx/res in Traxx_OnGoing_Updates) into
  PNGs under public/ui, so the shell shows the buttons Traxx shows.

    node scripts/traxx-ui-art.mjs [path/to/Traxx_OnGoing_Updates]

  Toolbar strips are 4-bit BMPs, 16x15 per button; MFC draws their light grey (192,192,192)
  as the button face, so it becomes transparent here. Icons are 32x32 4-bit ICOs with an AND mask.
*/
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { homedir } from "node:os";

const src = join(process.argv[2] ?? join(homedir(), "dev/Traxx_OnGoing_Updates"), "Traxx/res");
const out = new URL("../public/ui/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const strips = {
  "Toolbar.bmp": "toolbar-main.png",
  "editmode.bmp": "toolbar-editmode.png",
  "windowsb.bmp": "toolbar-windows.png",
  "textures.bmp": "toolbar-textures.png",
  "objects_.bmp": "toolbar-objects.png",
  "patterns.bmp": "toolbar-patterns.png",
  "palette_.bmp": "toolbar-palette.png",
};
const icons = ["edit0", "edit1", "edit2", "edit3", "edit4", "edit5", "edit6", "edit7", "level_ic", "vert_ico", "onground", "soundpla", "music_ic", "nomusic_", "traxxico"];

/** Decode a 1/4/8-bit BITMAPINFOHEADER image at `at`. Returns RGBA rows top-down. */
function decodeDib(b, at, width, height, maskRows = false) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const headerSize = v.getUint32(at, true);
  const bits = v.getUint16(at + 14, true);
  const colors = v.getUint32(at + 32, true) || (1 << bits);
  const pal = at + headerSize;
  let px = pal + colors * 4;
  const stride = Math.ceil((width * bits) / 32) * 4;
  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const y = height - 1 - row;
    for (let x = 0; x < width; x++) {
      const bit = x * bits;
      const byte = b[px + row * stride + (bit >> 3)];
      const index = (byte >> (8 - bits - (bit & 7))) & ((1 << bits) - 1);
      const o = (y * width + x) * 4;
      rgba[o] = b[pal + index * 4 + 2];
      rgba[o + 1] = b[pal + index * 4 + 1];
      rgba[o + 2] = b[pal + index * 4];
      rgba[o + 3] = 255;
    }
  }
  if (maskRows) {
    px += stride * height;
    const ms = Math.ceil(width / 32) * 4;
    for (let row = 0; row < height; row++) {
      const y = height - 1 - row;
      for (let x = 0; x < width; x++) {
        if ((b[px + row * ms + (x >> 3)] >> (7 - (x & 7))) & 1) rgba[(y * width + x) * 4 + 3] = 0;
      }
    }
  }
  return rgba;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

for (const [name, target] of Object.entries(strips)) {
  const b = readFileSync(join(src, name));
  const v = new DataView(b.buffer, b.byteOffset);
  const w = v.getInt32(18, true), h = v.getInt32(22, true);
  const rgba = decodeDib(b, 14, w, h);
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i] === 192 && rgba[i + 1] === 192 && rgba[i + 2] === 192) rgba[i + 3] = 0;
  }
  writeFileSync(join(out, target), png(w, h, rgba));
}
for (const name of icons) {
  const b = readFileSync(join(src, `${name}.ico`));
  const v = new DataView(b.buffer, b.byteOffset);
  const w = b[6] || 256, h = b[7] || 256;
  const at = v.getUint32(18, true);
  writeFileSync(join(out, `${name}.png`), png(w, h, decodeDib(b, at, w, h, true)));
}
console.log(`wrote ${Object.keys(strips).length + icons.length} images to ${out}`);

// The patterns file Traxx starts with (CTraxxReg: <Traxx folder>\Patterns.txp), copied as it is.
writeFileSync(join(out, "Patterns.txp"), readFileSync(join(src, "../Patterns.txp")));

// The stock icon sheet (IDB_STOCKICONS, 3 x 6 icons of 32x24): an RLE8 BMP the browser draws as it is.
writeFileSync(join(out, "stock-icons.bmp"), readFileSync(join(src, "stockico.bmp")));

// The Keyboard Summary's picture (IDB_KBDBMP, Help\Images\Keyboard Final2.bmp), drawn by the browser as it is.
writeFileSync(join(out, "keyboard.bmp"), readFileSync(join(src, "../Help/Images/Keyboard Final2.bmp")));

// The About box's hidden picture (IDB_BILL, res\bitmap1.bmp): GuitarBill, 1965-2004.
writeFileSync(join(out, "guitarbill.bmp"), readFileSync(join(src, "bitmap1.bmp")));
