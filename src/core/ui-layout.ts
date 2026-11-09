/*
  Layout rules of Traxx 1.7's resizable windows (commit e4b4cd5), as plain numbers so they can
  be tested: Stock Music, Texture Transitions and Patterns open larger and remember their size,
  Transitions samples any texture size safely, pattern thumbnails keep their aspect.
*/

export interface Size { w: number; h: number }

/**
  OnInitDialog (StockMusicDlg.cpp, TraxxPatternsDlg.cpp, TraxxTransitionsDlg.cpp): a remembered
  size wins when it is at least the template size (anything smaller is a stale value or a
  smaller screen); otherwise the first-time size. Never larger than the screen, never smaller
  than the template unless the screen is.
*/
export function openingSize(stored: Size | null | undefined, min: Size, first: Size, screen: Size): Size {
  const pick = stored && stored.w >= min.w && stored.h >= min.h ? stored : first;
  const w = Math.min(pick.w, screen.w), h = Math.min(pick.h, screen.h);
  return { w: Math.max(Math.min(min.w, screen.w), w), h: Math.max(Math.min(min.h, screen.h), h) };
}

/**
  TexturePattern::DisplayThumbnail (1.7): fit the bw x bh thumbnail inside the rw x rh display,
  keeping its aspect, whatever shape the display is; drawn from the top left. Null for an
  empty thumbnail.
*/
export function fitThumbnail(bw: number, bh: number, rw: number, rh: number): Size | null {
  if (bw <= 0 || bh <= 0) return null;
  if (rw * bh <= rh * bw) return { w: rw, h: Math.trunc((bh * rw) / bw) };
  return { w: Math.trunc((bw * rh) / bh), h: rh };
}

/**
  CTraxxTransitionsDlg::DrawGridImage (1.7): the texel of a w x h texture shown at (i, j) of a
  64 x 64 cell, sampled down (or up) whatever its size: data[(i*w)/64 + w*((j*h)/64)].
*/
export function sample64(w: number, h: number, i: number, j: number): number {
  return Math.trunc((i * w) / 64) + w * Math.trunc((j * h) / 64);
}

/**
  LayoutItems' LAY_SQUARE (TraxxTransitionsDlg.cpp): the 3 x 3 grid stays square and takes the
  largest square that fits the room it is given.
*/
export function squareSide(w: number, h: number): number {
  return Math.max(0, Math.min(w, h));
}
