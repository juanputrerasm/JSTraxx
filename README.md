# JSTraxx

A web implementation of Traxx, the classic Monster Truck Madness 2 track editor, ported from Traxx 1.6.7.

**Open it in your browser: https://juanputrerasm.github.io/JSTraxx/** (Chrome, Edge, Firefox or Safari; nothing to install).

To work on it locally:

```sh
npm install
npm run dev
npm test
```

On first run, open **View > Game Library** and add the `.POD` files from your MTM2 folder. JSTraxx copies them into the browser's private storage (OPFS) and reads art and models from them, top of the list first, as the game does.

Tracks open as in Traxx: **New**, **Open** (a saved `.TXX`), **View POD** (read-only), and **Clone TrackEd Track** (pick the TrackEd folder holding WORLD, LEVELS and DATA). **Import Viewed POD as Track** turns a viewed POD into an editable track: it extracts the art and models, then saves a `.TXX`.

Storage in OPFS mirrors Traxx's folders: `jstraxx/art` and `jstraxx/models` are its ART and MODELS folders (shared by every track), `jstraxx/tracks` holds saved `.TXX` files, and `jstraxx/library` the game PODs. A track's art and models are looked up in the ART and MODELS folders, then in the library.

## The 3D view

The view is Traxx's: its fly camera (arrows or the keypad to move and turn, PgUp and PgDn to pitch, A and Z to climb, comma and period to strafe, Shift for speed, keypad 5 to level, Home to face north, F2 and F3 to save and return to a place, F4 to keep the height above the ground), its grid window, Wire Frame, gamma and colours. On top of that the mouse can move too: the wheel goes forward and back (Ctrl for up and down), middle-drag looks around, Shift+middle-drag pans, and Alt+left-drag orbits the point under the pointer. Click the terrain map to jump there.

## Windows and dialogs

The Textures, Models, Patterns and Transitions windows work as Traxx's do. The Textures window's **Load >>** pane lists the ART folder and then the game library's art; loading a PNG or TGA keeps it as HD art and builds its 8-bit tile in memory with Traxx's own median cut, and textures picked from disk are copied into the ART folder so the track finds them again. The Patterns window starts with Traxx's own `Patterns.txp`. Object, Group and Light Properties show their changes in the view as you type, and Cancel puts them back. Track Components, Random Terrain, Lighting, Weather Mask, Palette, Statistics and the Keyboard Summary are all there; **Help > Contents** opens Traxx's own help, converted to pages. **File > Save View as Image** stands in for Print.

Every change can be undone, in every mode.

## Writing a POD

**File > Write POD** checks the track first (the "Incomplete Track" list), then writes the POD as Traxx does, entry for entry: the textures in their own palettes, their HD sources and `_N` / `_AO` maps found beside them in the ART folder or the library, the models, sounds, music, pictures, the situation file (`.SI2` when the legacy fallback is left out) and the `.TXV` record. Tracks Traxx wrote come back out byte for byte. The POD is saved through the browser's save dialog where there is one, or downloaded. **Options > Auto-Save** saves a modified track every few minutes, over its own file or to `TraxxAuto.txx`.

## Parity with Traxx

`docs/PARITY.md` lists every Traxx menu item, key, mouse action, window, dialog and file format with where it stands in JSTraxx, what was changed on purpose and what is left out, with a box to tick for each when checking it in a browser against Traxx.

## Layout

| Folder | What it holds |
| --- | --- |
| `src/core` | Pure TypeScript: Traxx's file rules (`core/traxx`), the track document and its loaders (`core/doc`), settings, the VFS. Runs in workers and under `node --test`. |
| `src/render` | The 3D view (three.js): terrain, ground boxes, objects, water, backdrop, course, the 2D overlay. Follows Traxx's GL view. |
| `src/worker` | Module workers. `asset-worker.ts` keeps the POD library and serves reads. |
| `src/shared` | OPFS helpers, the worker protocol, DOM and event helpers. |
| `src/app` | App state, the library service, worker startup. |
| `src/ui` | The editor window: menus, toolbars, dock bars, floating windows, dialogs. |
| `src/vendor/openphotex` | Vendored [OpenPhotex](https://github.com/juanputrerasm/OpenPhotex), the file-format library. Never edited by hand. |
| `public/ui` | Traxx's toolbar strips, icons, keyboard picture, stock icon sheet and `Patterns.txp`, from `scripts/traxx-ui-art.mjs`. |
| `docs` | `PARITY.md`, the checklist against Traxx. |
| `public/help` | Traxx's help, converted from its WinHelp sources by `scripts/traxx-help.mjs`. |

`npm run assets` regenerates `public/ui`, `public/help` and `src/core/traxx/stock-data.ts` (Traxx's stock palettes, default fog map, default pictures and stock sound lists) from a Traxx checkout at `~/dev/Traxx_OnGoing_Updates`; each script also takes the path as its argument.

## Credits

JSTraxx continues Traxx: Traxx (c) 1997 SoftParts, Traxx 1.5 (c) 2005 Richard Borchard III, the 1.6 GL update by Juan Pablo Utreras "Kmaster" and the 1.6 CP3 updates by Fila. It is built with [OpenPhotex](https://github.com/juanputrerasm/OpenPhotex) for the TRI file formats and takes its model rendering from [JSTrackViewer](https://github.com/juanputrerasm/JSTrackViewer).

## Deployment

Every push to `main` runs `.github/workflows/pages.yml`: it installs, runs the tests, builds and publishes `dist/` to GitHub Pages. The build uses relative paths, so `dist/` also runs from any other static host.

## License

Free for non-commercial use under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). [NOTICE.md](NOTICE.md) explains why, who holds the rights in the original Traxx, and how to reach us if you are one of them. The vendored OpenPhotex keeps its Apache License 2.0.
