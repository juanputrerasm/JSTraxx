/*
  Traxx's camera onto a three.js camera. Scene units are Traxx's: x and y in ipos (64 a cell),
  z in ALTITUDESCALE units (3 a terrain step), z up. Orientation turns clockwise from north;
  elevation 900 is level, 1800 straight down, 0 straight up.
*/
import * as THREE from "three";
import type { TraxxCamera } from "../core/view/camera.ts";

export function applyTraxxCamera(target: THREE.PerspectiveCamera, cam: Pick<TraxxCamera, "x" | "y" | "z" | "orientation" | "elevation">): void {
  target.up.set(0, 0, 1);
  target.position.set(cam.x, cam.y, cam.z);
  const heading = (cam.orientation * Math.PI) / 1800;
  const pitch = ((900 - cam.elevation) * Math.PI) / 1800;
  // From three's default (looking down -z, up +y): tilt up to look north, pitch, then turn clockwise.
  target.rotation.set(Math.PI / 2 + pitch, 0, -heading, "ZXY");
  target.updateMatrixWorld();
}
