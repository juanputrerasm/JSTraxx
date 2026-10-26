/*
  A new track: CTrackPOD's constructor and Reset, then CTraxxDoc::OnNewDocument (MTM2_ONLY and
  LoadMTM2Palette: stock palette 0, the default fog map and the default pictures).

  Traxx's Reset leaves the trucks, the ambient sound and the weather mask as the last track
  had them, so in Traxx a new track can inherit them. A new track here always starts from the
  constructor's values.
*/
import type { TxxTrack } from "../traxx/txx.ts";
import { traxxTruckDefaults } from "../traxx/sit.ts";
import { applyMtm2Palette, emptyPalette } from "../traxx/palette.ts";
import { CELLS, flatLte } from "../traxx/terrain.ts";
import { emptyCarry, MTM2_ONLY, type TrackDocument } from "./document.ts";

export const TRACKTYPE_DRAG = 1;
export const TRACKTYPE_CIRCUIT = 2;
export const TRACKTYPE_RALLY = 3;
export const TRACKTYPE_RUMBLE = 4;

/** CTrackPOD::CTrackPOD truck names. */
const TRUCK_NAMES = ["powerbig.trk", "bigfoot.trk", "grave.trk", "boogey.trk", "wildfoot.trk", "bearfoot.trk", "snakebit.trk", "rampage.trk", "overkill.trk"];

/** The track record of CTrackPOD after its constructor and Reset. */
export function resetTrack(): TxxTrack {
  return {
    version: 0,
    comment: "",
    prefix: "TRAXX",
    trackName: "new track",
    localeName: "Traxxville USA",
    logoBmpName: "",
    mapBmpName: "",
    trackType: TRACKTYPE_CIRCUIT,
    waterLevel4: 0,
    versionFlags: 0,
    ambientSound: 14,
    weatherMask: 65535,
    logoBmp: null, mapBmp: null, music: null, text: null, infoBmp: null, infoText: null,
    detailExt: "", detailMap: null, maskExt: "", maskMap: null,
    uiHd: [null, null, null],
    paletteName: "",
    palette: emptyPalette(),
    textures: [],
    models: [],
    boxes: [],
    course: [],
    extendedCourses: [null, null, null, null],
    heights: new Uint8Array(CELLS).fill(100),
    clr: new Uint16Array(CELLS),
    lte: flatLte(),
    trucks: TRUCK_NAMES.map((name) => ({ ...traxxTruckDefaults(), name })),
    backdropName: "",
    extraBackdrops: [],
    arena: null,
    omitRawFallback: false,
    fogMap: null,
    groundBoxes: [],
    sounds: [],
    animations: [],
    sun: { vector: [-46333, -46333, 0], shadowIntensity: 32768, position: [32000, -46333, 0], intensity: 64000 },
  };
}

export function newTrackDocument(): TrackDocument {
  const track = resetTrack();
  track.versionFlags = MTM2_ONLY;
  const p = applyMtm2Palette({ palette: track.palette, fogMap: track.fogMap, logoBmp: null, mapBmp: null, logoHd: false, mapHd: false });
  track.palette = p.palette;
  track.fogMap = p.fogMap;
  track.logoBmp = p.logoBmp;
  track.mapBmp = p.mapBmp;
  return {
    track,
    textures: [],
    modelTextures: [],
    models: [],
    carry: emptyCarry(),
    prefixAuto: true,
    viewOnly: false,
    source: { kind: "new" },
    objectsShort: 0,
    objectsDropped: 0,
    groundBoxOverflow: 0,
    missingTextures: [],
    missingModels: [],
    warnings: [],
  };
}
