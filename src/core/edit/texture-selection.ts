/*
  The Textures window's selection (Traxx/TraxxTexturesDlg.cpp, MULTISELECT 2026-09-28 and BOX
  SELECT 2026-09-30). `anchor` is the one texture painting, flood, cut, copy and animate act
  on; `set` holds the rest of a multiselection, the anchor included, and is empty for a single
  selection. Type and grip depth changes go to every selected texture.
*/
export class TextureSelection {
  anchor = -1;
  private set = new Set<number>();
  /** The texture count when the set was made: a different count drops it (Display). */
  private madeFor = 0;

  get size(): number {
    return this.set.size;
  }

  has(i: number): boolean {
    return i >= 0 && (i === this.anchor || this.set.has(i));
  }

  /** Every selected texture, ascending. */
  all(): number[] {
    if (!this.set.size) return this.anchor >= 0 ? [this.anchor] : [];
    return [...this.set].sort((a, b) => a - b);
  }

  clearSet(): void {
    this.set.clear();
  }

  /** SetSelection: picking something outside the set ends the set. */
  select(i: number): void {
    if (this.set.size && (i < 0 || !this.set.has(i))) this.set.clear();
    this.anchor = i;
  }

  /** Display's checks: the anchor kept in range, a set made for another list dropped. */
  validate(count: number): void {
    if (this.anchor >= count) this.select(count - 1);
    if (this.set.size && count !== this.madeFor) this.set.clear();
  }

  /** Shift+click (ToggleMultiSel). */
  toggle(i: number, count: number): void {
    if (i < 0 || i >= count) return;
    if (!this.set.size) {
      if (this.anchor < 0 || this.anchor === i) { this.select(i); return; }
      this.set.add(this.anchor);
    }
    this.madeFor = count;
    if (this.set.has(i)) {
      this.set.delete(i);
      if (i === this.anchor) {
        const next = [...this.set].sort((a, b) => a - b)[0];
        this.select(next ?? -1);
      }
      if (this.set.size <= 1) this.set.clear();
    } else {
      this.set.add(i);
      this.anchor = i;
    }
  }

  /**
    SelectGridBox: `touched` in grid order, `pressed` the one the drag began on (or -1).
    Plain replaces the selection, the anchor being the pressed one or the first; Shift adds and
    keeps the anchor. An empty box clears a plain selection.
  */
  box(touched: readonly number[], pressed: number, add: boolean, count: number): void {
    if (!add) this.set.clear();
    else if (!this.set.size && this.anchor >= 0) this.set.add(this.anchor);
    for (const i of touched) this.set.add(i);
    this.madeFor = count;
    if (!touched.length) {
      if (!add) { this.set.clear(); this.select(-1); } else if (this.set.size <= 1) this.set.clear();
      return;
    }
    if (!add || this.anchor < 0) this.anchor = pressed >= 0 ? pressed : touched[0]!;
    if (this.set.size <= 1) this.set.clear();
  }
}
