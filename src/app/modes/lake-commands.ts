/*
  The lake commands on the Terrain right-click menu (Traxx/TraxxViewEdit.cpp OnTerrainCreateLake,
  OnTerrainEditLake, OnTerrainDeleteLake, OnTerrainRemoveSeed, OnTerrainAddSeed; the items are
  built in TraxxViewInteract.cpp for the highlighted tile). Each is one undo step, recorded only
  once it has succeeded, so a refusal or a Cancel leaves the history as it was.

  Traxx 1.7.1: the lakes are derived with the spillway notches the waterfalls cut (trackLakes),
  the Lake window's "Holds up to" is HoldsUpTo, a lake's deletion turns its falls into springs at
  its height (LakeDeleted, with Traxx's message), and the undo records the falls with the lakes.

  Traxx 1.7.3: the lakes run their rule (the track's lakeRule, EDGE unless a viewed pod's .WTR was
  built with the tile rule); a new lake's spill is measured under it; the Lake window's Problems box
  says where a leak gets out and where the ground is exactly at the water's height.

  Also the lake guard every terrain edit passes (LakesRefuseTerrainEdit): an edit that gives a
  lake an error it did not have is put back, with Traxx's message.
*/
import { cellsOf } from "../../core/traxx/world.ts";
import type { ModeContext } from "./context.ts";
import type { MenuItem } from "../../ui/shell/commands.ts";
import type { TxxTrack, TxxLake } from "../../core/traxx/txx.ts";
import { recordFields } from "../../core/edit/record.ts";
import { alertDialog } from "../../ui/shell/dialog.ts";
import { lakeDialog } from "../../ui/dialogs/lake-dialog.ts";
import { cG } from "../../core/traxx/veg.ts";
import { buildLakeGround } from "../../core/traxx/surface.ts";
import {
  distinctHeights, trackLakes, lakeAt, lakeMaxHeightFor, lakeMinHeightFor, lakeErrorText, lakeFitHeight, lakeHoldsUpTo, lakeMinHeight, lakeSpill, seedIndex,
  LAKE_MAX_LAKES, LAKE_MAX_SEEDS, LAKE_NO_BASIN, LAKEERR_LAST, LAKEFLAG_REFLECTIVE, type LakesState,
} from "../../core/traxx/lakes.ts";
import { fallsLakeDeleted, fallsOnLake, trackNotches } from "../../core/traxx/falls.ts";

/** RecomputeLakes: the derived state for the track as it is now. */
export function lakesNow(t: TxxTrack): LakesState {
  return trackLakes(t);
}

/** The lakes' error bits, for the guard's before and after. */
export function lakeErrors(t: TxxTrack): number[] {
  return t.lakes.length ? lakesNow(t).lakes.map((l) => l.errors) : [];
}

/**
  LakesRefuseTerrainEdit: the message when the edit gave a lake an error it did not have
  (`before` from lakeErrors), or null. The caller puts the ground back.
*/
export function lakeRefusal(t: TxxTrack, before: number[], what: string): string | null {
  if (!t.lakes.length) return null;
  const now = lakeErrors(t);
  for (let l = 0; l < now.length; l++) {
    const gained = now[l]! & ~(before[l] ?? 0);
    if (!gained) continue;
    let bit = 1;
    while (!(gained & bit)) bit <<= 1;
    return `${what} was cancelled: Lake ${l + 1} - ${lakeErrorText(bit)}`;
  }
  return null;
}

export function lakeCommands(ctx: ModeContext, tile: () => [number, number] | null) {
  const { editor, registry, app } = ctx;
  const track = () => editor.doc!.track;
  const editable = () => editor.canEdit;
  const changed = () => editor.emit("changed", { water: true });

  const runDialog = async (idx: number, creating: boolean, before: TxxLake[]) => {
    const t = track();
    const lake = t.lakes[idx]!;
    const backup = structuredClone(lake);
    const ok = await lakeDialog(idx, lake, {
      changed: () => { changed(); return lakesNow(t).lakes[idx]!; },
      minHeight: () => lakeMinHeight(buildLakeGround(t), t.waterLevel4, lake, trackNotches(t), idx),
      distinctHeights: () => distinctHeights(t.lakes, t.waterLevel4),
      capacity: () => lakeHoldsUpTo(buildLakeGround(t), t.lakes, lakesNow(t), t.waterLevel4, idx),
      heightRange: () => { const g = buildLakeGround(t); return [lakeMinHeightFor(g), lakeMaxHeightFor(g)]; },
      cells: () => cellsOf(t),
    });
    if (!ok) {
      if (creating) t.lakes.splice(idx, 1);
      else t.lakes[idx] = backup;
      changed();
      return;
    }
    // Waterfalls on this lake follow its height by themselves (EffectiveHeight): said in the status line.
    if (!creating && lake.height !== backup.height) {
      const nf = fallsOnLake(t.falls, idx);
      if (nf > 0) app.status(`${nf} waterfall(s) follow this lake's new height`);
    }
    const after = structuredClone(t.lakes);
    t.lakes = before;
    const rec = recordFields(t, ["lakes"], creating ? "Create Lake" : "Edit Lake", { water: true });
    t.lakes = after;
    editor.commit(rec);
  };

  const create = async () => {
    const at = tile();
    if (!at || !editable()) return;
    const t = track();
    if (t.lakes.length >= LAKE_MAX_LAKES) { await alertDialog("Traxx", "This track already has the most lakes there can be."); return; }
    const [x, z] = at;
    const g = buildLakeGround(t);
    const tmap = lakesNow(t).tmap;
    // (under the track's lake rule: the notch input carries it)
    const rule = trackNotches(t);
    const s = lakeSpill(g, tmap, t.waterLevel4, x, z, -1, rule);
    // (a new lake owns no notch yet: FitHeight without one, as Traxx's lake index is past the list)
    if (s === LAKE_NO_BASIN) {
      if (t.waterLevel4 !== 0 && lakeSpill(g, tmap, 0, x, z, -1, rule) !== LAKE_NO_BASIN) await alertDialog("Traxx", "This square drains into the main water.");
      else await alertDialog("Traxx", "No basin here - the ground falls away.");
      return;
    }
    const before = structuredClone(t.lakes);
    const lake: TxxLake = { height: 0, flags: LAKEFLAG_REFLECTIVE, seeds: [[x, z]] };
    lake.height = lakeFitHeight(g, lake, s, s);
    t.lakes.push(lake);
    changed();
    await runDialog(t.lakes.length - 1, true, before);
  };

  const here = () => {
    const at = tile();
    if (!at || !editor.doc) return -1;
    return lakeAt(lakesNow(track()), track().lakes, at[0], at[1]);
  };

  const edit = async () => {
    const idx = here();
    if (idx < 0 || !editable()) return;
    await runDialog(idx, false, structuredClone(track().lakes));
  };

  const remove = async () => {
    const idx = here();
    if (idx < 0 || !editable()) return;
    // No confirmation: Undo covers it, the falls too. Falls on this lake become springs at its
    // height; later lakes shift down one, and so do the falls' sources (LakeDeleted).
    const t = track();
    const rec = recordFields(t, ["lakes", "falls"], "Delete Lake", { water: true, falls: true });
    const lakeheight = t.lakes[idx]!.height;
    const fallsonlake = fallsOnLake(t.falls, idx);
    t.lakes.splice(idx, 1);
    fallsLakeDeleted(t.falls, idx, lakeheight);
    editor.commit(rec);
    if (fallsonlake > 0) await alertDialog("Traxx", `${fallsonlake} waterfall(s) on this lake now have no source lake; they keep its height.`);
  };

  const removeSeed = () => {
    const idx = here(), at = tile();
    if (idx < 0 || !at || !editable()) return;
    const lake = track().lakes[idx]!;
    const si = seedIndex(track().lakes, idx, at[0], at[1], cellsOf(track()));
    if (si < 0 || lake.seeds.length <= 1) return;
    const rec = recordFields(track(), ["lakes"], "Remove Seed", { water: true });
    lake.seeds.splice(si, 1);
    editor.commit(rec);
  };

  const addSeed = async (l: number) => {
    const at = tile();
    if (!at || !editable()) return;
    const t = track();
    const lake = t.lakes[l];
    if (!lake || lake.seeds.length >= LAKE_MAX_SEEDS || here() >= 0) return;
    const old = lakesNow(t).lakes[l]!.errors;
    const rec = recordFields(t, ["lakes"], "Add Seed", { water: true });
    lake.seeds.push([at[0], at[1]]);
    const gained = lakesNow(t).lakes[l]!.errors & ~old;
    if (gained) {
      lake.seeds.pop();
      changed();
      let text = "That square cannot join this lake:";
      for (let bit = 1; bit <= LAKEERR_LAST; bit <<= 1) if (gained & bit) text += `\n${lakeErrorText(bit)}`;
      await alertDialog("Traxx", text);
      return;
    }
    editor.commit(rec);
  };

  registry.register({ id: "ID_TERRAIN_CREATELAKE", label: "Create Lake...", prompt: "Make a lake in the basin under the pointer" });
  registry.register({ id: "ID_TERRAIN_EDITLAKE", label: "Edit Lake...", prompt: "Edit the lake under the pointer" });
  registry.register({ id: "ID_TERRAIN_DELETELAKE", label: "Delete Lake", prompt: "Delete the lake under the pointer" });
  registry.register({ id: "ID_TERRAIN_REMOVESEED", label: "Remove This Seed", prompt: "Take this square out of the lake's seeds" });
  registry.bind("ID_TERRAIN_CREATELAKE", create, { enabled: editable });
  registry.bind("ID_TERRAIN_EDITLAKE", edit, { enabled: editable });
  registry.bind("ID_TERRAIN_DELETELAKE", remove, { enabled: editable });
  registry.bind("ID_TERRAIN_REMOVESEED", removeSeed, { enabled: editable });

  /** The lake items for the highlighted tile, appended to the Terrain menu. */
  const menuItems = (): MenuItem[] => {
    const at = tile();
    const doc = editor.doc;
    if (!at || !doc) return [];
    const t = doc.track;
    const idx = lakeAt(lakesNow(t), t.lakes, at[0], at[1]);
    if (idx >= 0) {
      const items: MenuItem[] = ["-", "ID_TERRAIN_EDITLAKE", "ID_TERRAIN_DELETELAKE"];
      if (seedIndex(t.lakes, idx, at[0], at[1], cellsOf(t)) >= 0 && t.lakes[idx]!.seeds.length > 1) items.push("ID_TERRAIN_REMOVESEED");
      return items;
    }
    const items: MenuItem[] = ["-", "ID_TERRAIN_CREATELAKE"];
    if (t.lakes.length) {
      const sub: MenuItem[] = t.lakes.map((lake, l) => {
        const id = `ID_TERRAIN_ADDSEED_${l}`;
        registry.register({ id, label: `Lake ${l + 1} - ${cG(lake.height / 4)}` });
        registry.bind(id, () => addSeed(l), { enabled: () => editable() && (track().lakes[l]?.seeds.length ?? LAKE_MAX_SEEDS) < LAKE_MAX_SEEDS });
        return id;
      });
      items.push({ label: "Add Seed to Lake", items: sub });
    }
    void app;
    return items;
  };

  return { menuItems };
}
