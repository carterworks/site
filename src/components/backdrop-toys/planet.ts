import { mulberry32 } from "../../lib/backdrop-noise";
import { line } from "./line";
import {
  fixedStep,
  frameLoop,
  pointOn,
  visibleCells,
  type Point,
  type Toy,
} from "./toy";

/** Land in 10° cells, from 90°N and 180°W. */
const LAND = [
  "............###.....................",
  ".......#########..........###.......",
  ".####.#####..##.#..#################",
  "..##.#####.#.....#.################.",
  ".....########....######.#########...",
  "......######.....###..###########...",
  ".......###......########.#######....",
  "........##......######.#..#.###.....",
  "..........###.....######.....###....",
  "..........#####.....####.....#####..",
  "..........######....####.......###..",
  "...........###......###.......#####.",
  "...........##........#.........##...",
  "...........#......................#.",
  "...........#........................",
  "...........##.......................",
  "######.....#########################",
  "####################################",
];
const SPHERE_POINTS = 16_000;
const CITIES = 80;
const SPIRE = 1.015;
const TILT = 0.55;
/** Radians per ms it drifts at untouched: a turn in about three and a half minutes. */
const DRIFT = 0.00003;
/**
 * How long it drifts after the start or the last press, then how long the
 * drift eases out over, together well inside the 30 s the contract allows.
 */
const DRIFT_MS = 15_000;
const EASE_OUT_MS = 8000;
/** The share of the gap to the drift kept each step, so a fling slows to it. */
const FRICTION = 0.96;
/** Radians per ms within which the speed has reached the drift. */
const STILL_SPEED = 1e-6;
/**
 * A press held this long without moving catches a fling, and a release this
 * long after the last move drops it; a quicker tap leaves it turning.
 */
const FLING_MS = 100;
const STEP_MS = 1000 / 60;
const MAX_CATCH_UP_MS = 100;

/**
 * A planet of points rising from the lower right of the visible cells, its
 * land a Fibonacci sphere masked by a coarse map, shaded by depth behind a
 * dashed limb, with short spires for cities. It drifts slowly on its own, and
 * a horizontal drag turns it; a fling slows back to the drift, and a held
 * press stops it. A while after the start or the last press the drift eases
 * to a stop and the loop sleeps.
 *
 * It draws white on transparent, each shade as alpha, into its own image
 * data put whole each frame.
 */
export const planet: Toy = {
  id: "planet",
  label: "Planet",
  start(canvas) {
    const context = canvas.getContext("2d");
    if (context === null) return () => {};
    const { width, height } = canvas;
    const image = context.createImageData(width, height);
    const pixels = image.data;
    const land: number[] = [];
    for (let i = 0; i < SPHERE_POINTS; i += 1) {
      const y = 1 - (2 * (i + 0.5)) / SPHERE_POINTS;
      const r = Math.sqrt(1 - y * y);
      const x = Math.cos(i * 2.39996) * r;
      const z = Math.sin(i * 2.39996) * r;
      const row = Math.floor((90 - (Math.asin(y) * 180) / Math.PI) / 10);
      const column = Math.floor((Math.atan2(z, x) * 18) / Math.PI + 18) % 36;
      if (LAND[Math.min(17, row)][column] === "#") land.push(x, y, z);
    }
    const points = Float32Array.from(land);
    const random = mulberry32(9);
    const cities: number[] = [];
    while (cities.length < CITIES) {
      const at = Math.floor(random() * (points.length / 3)) * 3;
      if (Math.abs(points[at + 1]) < 0.8) cities.push(at);
    }

    let cx = 0;
    let cy = 0;
    let radius = 1;
    const fit = () => {
      const { right, bottom, left, top } = visibleCells(canvas);
      const size = Math.min(bottom - top, ((right - left) * 9) / 16);
      cx = right - 0.46 * size;
      cy = bottom + 0.42 * size;
      radius = 1.15 * size;
    };
    fit();

    let angle = 0;
    let speed = DRIFT;
    let direction = 1;
    let touchedAt = performance.now();
    let now = touchedAt;
    let held = false;
    let dragging = false;
    let dragX = 0;
    let movedAt = 0;

    let px = 0;
    let py = 0;
    let pz = 0;
    const project = (at: number, lift: number) => {
      const x = points[at] * lift;
      const y = points[at + 1] * lift;
      const z = points[at + 2] * lift;
      const turnedZ = x * Math.sin(angle) + z * Math.cos(angle);
      px = cx + (x * Math.cos(angle) - z * Math.sin(angle)) * radius;
      py = cy - (y * Math.cos(TILT) - turnedZ * Math.sin(TILT)) * radius;
      pz = y * Math.sin(TILT) + turnedZ * Math.cos(TILT);
    };

    const plot = (x: number, y: number, level: number) => {
      x = Math.round(x);
      y = Math.round(y);
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const i = (y * width + x) * 4;
      const opacity = level * 255;
      if (opacity <= pixels[i + 3]) return;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      pixels[i + 3] = opacity;
    };

    const base: Point = { x: 0, y: 0 };
    const tip: Point = { x: 0, y: 0 };
    let spireLength = 1;
    const spirePixel = (x: number, y: number) => {
      const along = Math.max(Math.abs(x - base.x), Math.abs(y - base.y));
      plot(x, y, 0.3 + (0.1 * along) / spireLength);
    };

    const draw = () => {
      pixels.fill(0);
      for (let at = 0; at < points.length; at += 3) {
        project(at, 1);
        if (pz > 0.05) plot(px, py, 0.16 + pz * 0.22);
      }
      for (let turn = Math.PI; turn < 2 * Math.PI; turn += 0.6 / radius) {
        if (Math.round(turn * radius) % 2 === 0) {
          plot(cx + Math.cos(turn) * radius, cy + Math.sin(turn) * radius, 0.3);
        }
      }
      for (const at of cities) {
        project(at, 1);
        if (pz < 0.1) continue;
        base.x = Math.round(px);
        base.y = Math.round(py);
        project(at, SPIRE);
        tip.x = Math.round(px);
        tip.y = Math.round(py);
        spireLength = Math.max(
          1,
          Math.abs(tip.x - base.x),
          Math.abs(tip.y - base.y),
        );
        line(base, tip, spirePixel);
      }
      context.putImageData(image, 0, 0);
    };

    const drift = () => {
      if (held) return 0;
      const easing = (now - touchedAt - DRIFT_MS) / EASE_OUT_MS;
      if (easing >= 1) return 0;
      if (easing <= 0) return DRIFT * direction;
      return ((DRIFT * direction) / 2) * (1 + Math.cos(Math.PI * easing));
    };

    const coast = () => {
      const target = drift();
      angle += speed * STEP_MS;
      speed = target + (speed - target) * FRICTION;
      if (Math.abs(speed - target) < STILL_SPEED) speed = target;
    };
    const pace = fixedStep(STEP_MS, MAX_CATCH_UP_MS);

    const { wake, stop } = frameLoop((time) => {
      now = time;
      if (held && now - movedAt > FLING_MS) speed = 0;
      if (!dragging) pace.advance(now, coast);
      draw();
      if (!dragging && (speed !== 0 || drift() !== 0)) return true;
      pace.restart();
      return false;
    });

    const onDown = (event: PointerEvent) => {
      // A forwarded copy is untrusted, and the relay already holds its pointer.
      if (event.isTrusted) canvas.setPointerCapture(event.pointerId);
      held = true;
      dragX = pointOn(canvas, event).x;
      movedAt = touchedAt = performance.now();
    };

    const onMove = (event: PointerEvent) => {
      if (!held) return;
      dragging = true;
      const x = pointOn(canvas, event).x;
      const now = performance.now();
      // The near side moves against the angle, so a drag right lowers it.
      const turn = (dragX - x) / radius;
      angle += turn;
      speed += (turn / Math.max(1, now - movedAt) - speed) * 0.5;
      dragX = x;
      movedAt = now;
      wake();
    };

    const onLift = () => {
      if (!held) return;
      held = dragging = false;
      touchedAt = performance.now();
      if (speed !== 0) direction = Math.sign(speed);
      if (touchedAt - movedAt > FLING_MS) speed = 0;
      wake();
    };

    const onResize = () => {
      fit();
      wake();
    };

    const listening = new AbortController();
    const { signal } = listening;
    canvas.addEventListener("pointerdown", onDown, { signal });
    canvas.addEventListener("pointermove", onMove, { signal });
    canvas.addEventListener("pointerup", onLift, { signal });
    canvas.addEventListener("pointercancel", onLift, { signal });
    window.addEventListener("resize", onResize, { signal });
    wake();

    return () => {
      listening.abort();
      stop();
    };
  },
};
