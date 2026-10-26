/* The five edit modes, registered with the editor (EDIT_TERRAIN .. EDIT_BUILDINGS). */
import { EDIT_BUILDINGS, EDIT_COURSE, EDIT_OBJECTS, EDIT_TERRAIN, EDIT_TEXTURES } from "../../core/settings.ts";
import type { ModeContext } from "./context.ts";
import { terrainMode } from "./terrain-mode.ts";
import { texturesMode } from "./textures-mode.ts";
import { courseMode } from "./course-mode.ts";
import { objectsMode } from "./objects-mode.ts";
import { groundBoxesMode } from "./ground-boxes-mode.ts";

export function registerModes(ctx: ModeContext): void {
  ctx.editor.register(EDIT_TERRAIN, terrainMode(ctx));
  ctx.editor.register(EDIT_TEXTURES, texturesMode(ctx));
  ctx.editor.register(EDIT_COURSE, courseMode(ctx));
  ctx.editor.register(EDIT_OBJECTS, objectsMode(ctx));
  ctx.editor.register(EDIT_BUILDINGS, groundBoxesMode(ctx));
}
