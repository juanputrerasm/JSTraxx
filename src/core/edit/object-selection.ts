/*
  Object selection, as Traxx keeps it (TraxxViewInteract.cpp, OBJECT MULTISELECT):

    - `anchor` is the selected object (objectindex): Properties, Copy and the highlight act on
      it; -1 for none;
    - `set` is the multi-selection (objsel). It is in force only while the anchor is one of its
      members, and the moment it is found out of force it is cleared, so a later selection
      landing on an old member cannot bring the rest back;
    - Ctrl+click toggles one object, Ctrl+drag adds every object inside the box;
    - a set down to one member is a single selection again.

  `exists(i)` says whether object i is still there.
*/
export class ObjectSelection {
  anchor = -1;
  private set = new Set<number>();

  /** ObjSelActive. */
  active(): boolean {
    if (this.set.size > 0 && !(this.anchor >= 0 && this.set.has(this.anchor))) this.set.clear();
    return this.set.size > 0;
  }

  /** IsObjectSelected. */
  has(i: number): boolean {
    if (i < 0) return false;
    if (i === this.anchor) return true;
    return this.active() && this.set.has(i);
  }

  /** CollectSelectedObjects: every selected object that exists, the anchor first. */
  collect(exists: (i: number) => boolean): number[] {
    const out: number[] = [];
    if (this.anchor >= 0 && exists(this.anchor)) out.push(this.anchor);
    if (this.active()) for (const i of [...this.set].sort((a, b) => a - b)) if (i !== this.anchor && exists(i)) out.push(i);
    return out;
  }

  clear(): void {
    this.set.clear();
  }

  /** A plain selection: one object (or none), the set out of force by itself. */
  select(i: number): void {
    this.anchor = i;
  }

  /** ToggleObjSel: Ctrl+click. */
  toggle(i: number, exists: (i: number) => boolean): void {
    if (i < 0 || !exists(i)) return;
    if (!this.active()) {
      this.set.clear();
      if (this.anchor === i) { this.anchor = -1; return; }
      if (this.anchor < 0 || !exists(this.anchor)) { this.anchor = i; return; }
      this.set.add(this.anchor);
    }
    if (this.set.has(i)) {
      this.set.delete(i);
      if (i === this.anchor) {
        const next = [...this.set].sort((a, b) => a - b).find(exists);
        this.anchor = next ?? -1;
      }
    } else {
      this.set.add(i);
      // The newest is the anchor: Properties opens on it.
      this.anchor = i;
    }
    if (this.set.size <= 1) this.set.clear();
  }

  /** SelectObjectsInRect: add every object in `inside` (already filtered to the box). */
  addAll(inside: readonly number[], exists: (i: number) => boolean): void {
    for (const i of inside) {
      if (this.has(i)) continue;
      if (!this.active()) {
        this.set.clear();
        if (this.anchor >= 0 && exists(this.anchor)) this.set.add(this.anchor);
        else this.anchor = i;
      }
      this.set.add(i);
    }
    if (this.set.size <= 1) this.set.clear();
  }

  /*
    Object indices shift when objects are deleted or inserted. `map(old)` gives the new index
    of an object, or -1 when it is gone.
  */
  remap(map: (old: number) => number): void {
    this.anchor = this.anchor >= 0 ? map(this.anchor) : -1;
    const next = new Set<number>();
    for (const i of this.set) { const n = map(i); if (n >= 0) next.add(n); }
    this.set = next;
    if (this.set.size <= 1) this.set.clear();
  }
}
