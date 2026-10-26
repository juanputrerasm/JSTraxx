/*
  The .SIT as Traxx keeps it. The fixture is laid out line by line as Traxx 1.6.7's WriteSITFile
  writes it (TrackPOD/TrackPODFile.cpp), independently of the writer, so reading it and writing
  it back must give the same bytes.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { cAtof, cAtoi, cFixed } from "../src/core/traxx/cformat.ts";
import {
  readTraxxSit, traxxIposToSit, traxxSignedSplit, traxxSitToIpos, traxxUiBitmapName, writeTraxxSit,
} from "../src/core/traxx/sit.ts";

const latin1 = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

const DELIM = "*********************************************";
const LAP = ["***Lap time***", "0", "*****Checkpoint times*****", ...Array<string>(20).fill("0")];

function truck(name: string, ipos: string, angles: string, course: number): string[] {
  return [
    "truckFile", name, "ipos", ipos, "bvel", "0,0,0", "theta,phi,psi", angles,
    "p,q,r", "0,0,0", "faxle.angle,faxle.steering_angle", "0,0", "faxle.rtire.on_gnd,faxle.ltire.on_gnd", "-1,1",
    "raxle.angle,raxle.steering_angle", "0,0", "raxle.rtire.on_gnd,raxle.ltire.on_gnd", "-1,1", "xm.gear", "4",
    "ap.autopilot,ap.cnumber", "0,1", "ap.speed_control,ap.course_control,ap.lasterror", "0,0,0", "!ap.courseToFollow", String(course),
    "$heliTimer,heliTheta,heliPhi,heliPsi", "0,0,0,0", "heliPos", "0,0,0",
    "^segments,laps,staged,bonusLaps,finishedRace,nextcheckpoint", "0,0,0,0,0,0", "totalracetime,fastestLap,dragTimer", "0,0,0",
    ...Array.from({ length: 20 }, () => LAP).flat(),
  ];
}

function segment(n: number, start: string, end: string, limits: string): string[] {
  return [`${DELIM} ${n}`, "ctype,cspeed_type", "1,0", "cstart", start, "cend", end,
    "cdec_point,cspeed,lastentry", "30.000000,0.000000,0", "&cSpeedLimit,cTrackWidth", limits];
}

const MOTION = ["mass", "0.000000", "bvel", "0.000000,0.000000,0.000000", "p,q,r", "0.000000,0.000000,0.000000"];
const SOUNDS = ["@sound effect entries", "NULL.WAV", "NULL.WAV", "0,0"];

function header(mtm2: boolean): string[] {
  return [
    "TEST.lvl", "!Race Track Name", "Test Track", "Race Track Locale", "Here", "Track Longtitude, Latitude", "7947984,7947988",
    "Track Logo .BMP file", "TESTS.BMP", "Track Map .BMP file", "TESTL.BMP", "Track Fly-By .AVI file", "Sonic",
    "Track Announcer .WAV file", "Track", "Track Description .TXT file", "0,0", "Track Race Type", "2", "@Redbook Audio Track", "2",
    ...(mtm2 ? ["!ambient sound,track length,weather mask", "3,5000.000000,5"] : []),
    "viewmode,spotd,spotp,spoth,zoom", "0,16384,-16383,24832,98304", "$racetime, raceStartTime, dragDebugTimer", "0.000000,0.000000,0.000000",
    "controlflag, autoShift, autoStage, bothStaged, bothStagedPrev", "0,1,0,0,0", "stageComFlag, bonusLapFlag", "0,0",
    "*** Your Truck (Not used anymore) ***", DELIM, ...truck("POWERBIG.TRK", "2000.000000,100.000000,3000.000000", "0.000000,0.000000,1.500000", 0),
    "*** Vehicles ***", "8",
    ...Array.from({ length: 8 }, (_, v) => [DELIM, ...truck("POWERBIG.TRK", `${2000 + 10 * v}.000000,100.000000,3000.000000`, "0.000000,0.000000,1.500000", 2)]).flat(),
  ];
}

const FIXTURE = [
  ...header(true),
  "*** Ramps ***", "1", DELIM, "ipos", "1000.000000,80.000000,1000.000000", "theta,phi,psi", "0.000000,0.000000,0.000000",
  "length,width,height", "40.000000,20.000000,10.000000", ...MOTION,
  "*** Boxes ***", "3",
  // 500.0078125 is exactly halfway at six decimals: printf rounds it to even.
  DELIM, "ipos", "500.007812,20.500000,1500.000000", "theta,phi,psi", "0.000000,0.000000,0.250000", "model", "ROCK.BIN",
  "mass", "12.500000", "bvel", "1.000000,3.000000,2.000000", "p,q,r", "0.000000,0.000000,0.000000",
  "!type,flags", "0,0", "priority", "1", ...SOUNDS,
  DELIM, "ipos", "600.000000,40.000000,700.000000", "theta,phi,psi", "0.000000,0.000000,0.000000",
  "length,width,height", "64.000000,8.000000,30.000000", ...MOTION, "!type,flags", "6,0", "priority", "0", ...SOUNDS,
  DELIM, "ipos", "800.000000,40.000000,900.000000", "theta,phi,psi", "0.000000,0.000000,0.000000", "model", "LAMP.BIN", ...MOTION,
  "!type,flags", "12,0", "priority", "0", ...SOUNDS,
  "Llight rad,hgt,r,g,b,glow,glowRad,coneLen,coneRim,coneBase,bright,aimOff",
  "80.000000,10.000000,1.000000,0.500000,0.250000,2,6.000000,125.000000,10.000000,3.500000,1.250000,4.000000",
  "*** Cylinders ***", "1", DELIM, "ipos", "1,2,3",
  "*** Top Crush ***", "1", DELIM, "ipos", "300.000000,30.000000,400.000000", "ipos2", "300.000000,34.000000,400.000000",
  "theta,phi,psi", "0.000000,0.000000,0.000000", "modelName", "CPCRUB2.BIN", "cabModelName", "CPCRUB1.BIN", ...MOTION,
  "*** Course ***", "c1Count,course_direction", "2,0",
  ...segment(1, "1000.000000,60.000000,2000.000000", "1100.000000,60.000000,2000.000000", "40.000000,16.000000"),
  ...segment(3, "1150.000000,60.000000,2050.000000", "1150.000000,62.000000,2200.000000", "0.000000,16.000000"),
  "@*********** Extended Course Definitions *************", "4",
  "[Course 1] c1Count,course_direction", "1,0", ...segment(1, "10.000000,0.000000,20.000000", "30.000000,0.000000,40.000000", "0.000000,32.000000"),
  "[Course 2] c1Count,course_direction", "0,0", "[Course 3] c1Count,course_direction", "0,0", "[Course 4] c1Count,course_direction", "0,0",
  "*** Stadium ***", "stadiumFlag,stadiumModelName", "0,none", "*** Backdrop ***", "backdropType,backdropCount", "0,1", "backdropModelName", "BACK.BIN",
].map((line) => `${line}\r\n`).join("");

test("cFixed rounds the exact binary value, ties to even, as printf does", () => {
  assert.equal(cFixed(0.0078125), "0.007812");
  assert.equal(cFixed(0.0234375), "0.023438");
  assert.equal(cFixed(500.0078125), "500.007812");
  assert.equal(cFixed(1 / 3), "0.333333");
  assert.equal(cFixed(Math.fround(0.1)), "0.100000");
  assert.equal(cFixed(5000), "5000.000000");
  assert.equal(cFixed(-0), "-0.000000");
  assert.equal(cFixed(-1e-9), "-0.000000");
  assert.equal(cFixed(1e20), "100000000000000000000.000000");
  assert.equal(cFixed(2.345, 2), "2.35");
  assert.equal(cFixed(0.125, 2), "0.12");
});

test("cAtof and cAtoi take the leading number as the C library does", () => {
  assert.equal(cAtof("  12.5abc"), 12.5);
  assert.equal(cAtof("-.5,1"), -0.5);
  assert.equal(cAtof("1e2"), 100);
  assert.equal(cAtof("x"), 0);
  assert.equal(cAtoi(" 7,8"), 7);
  assert.equal(cAtoi("2.9"), 2);
  assert.equal(cAtoi(""), 0);
});

test("ipos conversions split into whole steps and 1/256 fractions, wrapping negatives", () => {
  assert.deepEqual(traxxSitToIpos(500.0078125), [1000, 4]);
  assert.deepEqual(traxxSitToIpos(-1), [16382, 0]);
  assert.deepEqual(traxxSitToIpos(10.998), [21, 255]);
  assert.deepEqual(traxxSitToIpos(10.999999), [22, 0]);
  assert.deepEqual(traxxSignedSplit(-1.25), [-2, 192]);
  assert.equal(traxxIposToSit(1000, 4), 500.0078125);
  assert.equal(traxxUiBitmapName("", "TEST", "S"), "TESTS.BMP");
  assert.equal(traxxUiBitmapName("KEEP.BMP", "TEST", "L"), "KEEP.BMP");
});

test("a SIT laid out as Traxx writes it reads into Traxx's fields", () => {
  const sit = readTraxxSit(latin1(FIXTURE), "TEST.SIT");
  assert.equal(sit.prefix, "TEST");
  assert.equal(sit.trackName, "Test Track");
  assert.equal(sit.logoBmpName, "TESTS.BMP");
  assert.equal(sit.trackType, 2);
  assert.equal(sit.mtm2Only, true);
  assert.equal(sit.ambientSound, 3);
  assert.equal(sit.weatherMask, 5);
  assert.deepEqual(sit.trucks[0].ipos, [4000, 6000, 50]);
  assert.equal(sit.trucks[0].psi, 1.5);
  assert.equal(sit.trucks[8].ipos[0], 4140);
  assert.equal(sit.trucks[8].course, 2);
  assert.equal(sit.boxes.length, 5);

  const [ramp, rock, checkpoint, lamp, crush] = sit.boxes;
  assert.equal(ramp.type, 99);
  assert.deepEqual([ramp.length, ramp.width, ramp.height], [40, 20, 10]);
  assert.deepEqual(rock.ipos, [1000, 3000, 10]);
  assert.deepEqual(rock.fraction, [4, 0, 64]);
  assert.equal(rock.modelName, "ROCK.BIN");
  // A box naming a model keeps Traxx's default size; bvel comes back east, north, up.
  assert.deepEqual([rock.length, rock.width, rock.height], [64, 64, 20]);
  assert.deepEqual(rock.bvel, [1, 2, 3]);
  assert.equal(rock.mass, 12.5);
  assert.equal(rock.priority, 1);
  assert.equal(checkpoint.type, 6);
  assert.equal(checkpoint.checkpointSeq, 0);
  assert.equal(lamp.light.radius, 80);
  assert.equal(lamp.light.glowMode, 2);
  assert.equal(lamp.light.bright, 1.25);
  assert.equal(lamp.light.aimOffset, 4);
  assert.equal(crush.type, 98);
  assert.equal(crush.modelName, "CPCRUB2.BIN");
  assert.equal(crush.crushName, "CPCRUB1.BIN");
  assert.deepEqual(crush.crush, [0, 0, 4]);

  assert.equal(sit.cylinderCount, 1);
  assert.equal(sit.cylinderRaw, `${DELIM}\r\nipos\r\n1,2,3\r\n`);
  assert.equal(sit.course.length, 2);
  assert.deepEqual(sit.course[0].cstart, [2000, 4000, 30]);
  assert.equal(sit.course[0].speedLimit, 40);
  assert.equal(sit.course[0].trackWidth, 16);
  assert.equal(sit.course[1].cend[2], 31);
  assert.equal(sit.extendedCourses[0]?.length, 1);
  assert.equal(sit.extendedCourses[1], null);
  assert.equal(sit.arena, null);
  assert.equal(sit.backdropName, "BACK.BIN");
});

test("writeTraxxSit writes back the same bytes Traxx wrote", () => {
  const out = writeTraxxSit(readTraxxSit(latin1(FIXTURE), "TEST.SIT"));
  assert.equal(new TextDecoder("latin1").decode(out), FIXTURE);
});

test("an arena track writes the MTM2 stadium line and an empty backdrop", () => {
  const sit = readTraxxSit(latin1(FIXTURE), "TEST.SIT");
  sit.arena = { x: 120, y: 100, sx: 14, sy: 14 };
  sit.backdropName = "ARENA.BIN";
  const text = new TextDecoder("latin1").decode(writeTraxxSit(sit));
  assert.ok(text.endsWith("*** Stadium ***\r\n!stadiumFlag,x,z,sx,sz,stadiumModelName\r\n1,120,100,14,14,ARENA.BIN\r\n"
    + "*** Backdrop ***\r\nbackdropType,backdropCount\r\n0,0\r\nbackdropModelName\r\n\r\n"));
  const back = readTraxxSit(text, "TEST.SIT");
  assert.deepEqual(back.arena, { x: 120, y: 100, sx: 14, sy: 14 });
  assert.equal(back.backdropName, "ARENA.BIN");
});

test("an MTM1 SIT has no ambient line and writes the old stadium form", () => {
  const text = [...header(false), "*** Ramps ***", "0", "*** Boxes ***", "0", "*** Cylinders ***", "0", "*** Top Crush ***", "0",
    "*** Course ***", "c1Count,course_direction", "0,0", "@*********** Extended Course Definitions *************", "4",
    "[Course 1] c1Count,course_direction", "0,0", "[Course 2] c1Count,course_direction", "0,0",
    "[Course 3] c1Count,course_direction", "0,0", "[Course 4] c1Count,course_direction", "0,0",
    "*** Stadium ***", "stadiumFlag,stadiumModelName", "1,OLDARENA.BIN", "*** Backdrop ***", "backdropType,backdropCount", "0,0",
    "backdropModelName", ""].map((line) => `${line}\r\n`).join("");
  const sit = readTraxxSit(text, "TEST.SIT");
  assert.equal(sit.mtm2Only, false);
  assert.deepEqual(sit.arena, { x: 127, y: 127, sx: 18, sy: 18 });
  assert.equal(new TextDecoder("latin1").decode(writeTraxxSit(sit)), text);
});

test("box sounds are kept; segment speeds are written as Traxx writes them", () => {
  const sounds = "!type,flags\r\n0,0\r\npriority\r\n1\r\n@sound effect entries\r\nHIT.WAV\r\nLOOP.WAV";
  const withSounds = FIXTURE.replace("!type,flags\r\n0,0\r\npriority\r\n1\r\n@sound effect entries\r\nNULL.WAV\r\nNULL.WAV", sounds);
  const edited = withSounds.replace("cdec_point,cspeed,lastentry\r\n30.000000,0.000000,0", "cdec_point,cspeed,lastentry\r\n12.000000,70.223442,1");
  const sit = readTraxxSit(edited, "TEST.SIT");
  assert.equal(sit.boxes[1].soundImpact, "HIT.WAV");
  assert.equal(sit.boxes[1].soundCont, "LOOP.WAV");
  assert.equal(new TextDecoder("latin1").decode(writeTraxxSit(sit)), withSounds);
});

test("without the archive entries, Traxx takes no stem, keeps no UI bitmap name and loads no backdrop", () => {
  const bare = readTraxxSit(FIXTURE, "TEST.SIT", { hasEntry: () => false });
  assert.equal(bare.prefix, "");
  assert.equal(bare.logoBmpName, "");
  assert.equal(bare.backdropName, "");
});

test("model names come back upper case, as Traxx keeps them", () => {
  const sit = readTraxxSit(FIXTURE.replace("model\r\nROCK.BIN", "model\r\nrock.bin"), "TEST.SIT");
  assert.equal(sit.boxes[1].modelName, "ROCK.BIN");
});

test("a section that declares more records than it holds keeps what is there and says so", () => {
  const short = FIXTURE.replace("*** Boxes ***\r\n3\r\n", "*** Boxes ***\r\n5\r\n");
  const sit = readTraxxSit(short, "TEST.SIT");
  assert.equal(sit.warnings.length, 1);
  assert.equal(sit.boxes.length, 5);
  assert.equal(sit.course.length, 2);
});
