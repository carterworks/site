import {
  clamp,
  fixedStep,
  cellScale,
  pointOn,
  visibleCells,
  type CellRect,
  type Point,
  type Toy,
} from "./toy";

const STAND = [
  "..#..#..",
  ".######.",
  "########",
  "########",
  "########",
  ".######.",
  ".#....#.",
];
const STRIDE_FEET = "..#..#..";
const CURLED = ["..####..", ".######.", "########", "########"];
const CURLED_EXHALE = "...##...";
const HEART = [".#.#.", "#####", ".###.", "..#."];
const ZED = ["###", ".#.", "###"];
const TUFTS = [3, 4, 11, 19, 20, 27, 34, 35, 43, 51, 52, 59, 66, 67, 75];
const TUFT_PERIOD = 80;

const SPRITE_HALF_WIDTH = 4;
/** Keeps the sprite's whole body, not only its centre, inside the visible span. */
const EDGE_MARGIN = SPRITE_HALF_WIDTH + 1;
/**
 * The pixel pitch the sprite was drawn for, from the gallery's ~9 px cells. A
 * sprite pixel is a square of whole cells that wide, so the critter keeps its
 * on-screen size on a denser grid; it is 1 cell per sprite pixel at 160 columns.
 */
const SPRITE_CELL_PX = 9;
/** Sprite pixels between the ground line and the bottom of the viewport. */
const GROUND_INSET = 7;

const MAX_CRUMBS = 6;
const EAT_DISTANCE = 1.5;
const ARRIVE_DISTANCE = 1.2;
const CRUMB_PATIENCE = 480;
const CRUMB_FADE = 40;
const RUB_WINDOW_MS = 900;
const RUBS_TO_DELIGHT = 4;
const LONELY_MS = 7000;
const DROWSY_STEPS = 120;
const STEP_MS = 1000 / 60;
/** A tab that was hidden resumes with a few steps, not the whole gap. */
const MAX_OWED_MS = 5 * STEP_MS;
/** One 140-step breath: the sleeper freezes inhaled, and a toy switch settles in about 4 s. */
const NAP_BREATH_STEPS = 140;
const BLINK_PERIOD_MS = 3400;
const BLINK_MS = 130;

/**
 * Where the critter can stand. Crumbs land inside it too, so a crumb can never
 * be somewhere the critter cannot walk.
 */
function reach({ left, right }: CellRect, into: { min: number; max: number }) {
  into.min = left + EDGE_MARGIN;
  into.max = Math.max(into.min, right - EDGE_MARGIN);
}

type Crumb = {
  x: number;
  y: number;
  vy: number;
  patience: number;
  fade: number;
};
type Floater = { glyph: string[]; x: number; y: number; life: number };

/**
 * A small critter on the bottom edge of the viewport. It naps curled up, wakes
 * to a tap, follows the pointer, delights in being rubbed, and walks to any
 * crumb a tap tosses. Left alone it dozes off again, and the sleeper stops
 * asking for frames once its last z has floated away.
 *
 * It is simulated in fixed 60 Hz steps, so its pace does not depend on the
 * display, and drawn white by alpha into its own image data.
 */
export const mote: Toy = {
  id: "mote",
  label: "Mote",
  look: { ghost: 55, noise: 10 },
  start(canvas) {
    const context = canvas.getContext("2d");
    if (context === null) return () => {};
    const { width: columns, height: rows } = canvas;
    const block = Math.max(1, Math.round(cellScale(SPRITE_CELL_PX, columns)));
    const unitsAcross = Math.ceil(columns / block);
    const image = context.createImageData(columns, rows);
    const pixels = image.data;
    const pressUnits: Point = { x: 0, y: 0 };
    const pointerUnits: Point = { x: 0, y: 0 };
    const visible: CellRect = { left: 0, top: 0, right: 0, bottom: 0 };
    const toUnits = (from: Point, into: Point) => {
      into.x = from.x / block;
      into.y = from.y / block;
      return into;
    };
    const critter = {
      x: 0,
      hop: 0,
      vy: 0,
      face: 0,
      asleep: true,
      breath: 0,
      walk: 0,
      happy: 0,
      drowsy: 0,
      startle: 0,
      lastDir: 0,
      rubs: [-Infinity, -Infinity, -Infinity, -Infinity],
      rubSlot: 0,
    };
    const crumbs: Crumb[] = [];
    const bounds = { min: 0, max: 0 };
    const floaters: Floater[] = [];
    let pointer: Point | undefined;
    let pressed = false;
    let seenPointerX: number | undefined;
    let placed = false;
    let ground = 0;
    let now = 0;
    let lastInputAt = 0;
    let frame: number | undefined;
    const pace = fixedStep(STEP_MS, MAX_OWED_MS);

    const layout = () => {
      const cells = visibleCells(canvas);
      visible.left = cells.left / block;
      visible.top = cells.top / block;
      visible.right = cells.right / block;
      visible.bottom = cells.bottom / block;
      ground = Math.floor(visible.bottom) - GROUND_INSET;
      reach(visible, bounds);
      if (!placed) {
        critter.x = bounds.min + 0.62 * (bounds.max - bounds.min);
        placed = true;
      }
    };

    const top = () =>
      ground -
      (critter.asleep ? CURLED.length : STAND.length) +
      Math.round(critter.hop);
    const over = (p: Point) =>
      Math.abs(p.x - critter.x) < 6 && p.y > top() - 2 && p.y < ground + 1;
    const float = (glyph: string[], x: number, y: number) =>
      floaters.push({ glyph, x, y, life: 150 });
    const heart = () => float(HEART, critter.x - 2, top() - 6);
    // Impulses added mid-air stack, so a hop only starts from the ground.
    const startHop = (vy: number) => {
      if (critter.hop === 0 && critter.vy === 0) critter.vy = vy;
    };
    const wake = () => {
      critter.asleep = false;
      startHop(-0.8);
      critter.startle = 40;
      critter.drowsy = 0;
    };
    const rubbedEnough = () => {
      for (const at of critter.rubs) {
        if (now - at >= RUB_WINDOW_MS) return false;
      }
      return true;
    };
    const nap = () => {
      critter.asleep = true;
      critter.breath = 0;
    };

    const paint = (x: number, y: number, value: number, overwrite: boolean) => {
      const originX = Math.round(x) * block;
      const originY = Math.round(y) * block;
      const alpha = Math.round(value * 255);
      for (
        let cy = Math.max(0, originY);
        cy < Math.min(rows, originY + block);
        cy += 1
      ) {
        for (
          let cx = Math.max(0, originX);
          cx < Math.min(columns, originX + block);
          cx += 1
        ) {
          const i = (cy * columns + cx) * 4;
          if (overwrite || pixels[i + 3] < alpha) {
            pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
            pixels[i + 3] = alpha;
          }
        }
      }
    };
    const plot = (x: number, y: number, value: number) =>
      paint(x, y, value, false);
    const set = (x: number, y: number, value: number) =>
      paint(x, y, value, true);
    /** One row can be swapped for another so animation frames need no copy. */
    const sprite = (
      glyph: string[],
      x: number,
      y: number,
      value: number,
      swapRow = -1,
      swapWith = "",
    ) => {
      for (let r = 0; r < glyph.length; r += 1) {
        const row = r === swapRow && swapWith ? swapWith : glyph[r];
        for (let k = 0; k < row.length; k += 1) {
          if (row[k] === "#") plot(x + k, y + r, value);
        }
      }
    };
    const eye = (x: number, y: number, closed: boolean) => {
      set(x, y, closed ? 0.45 : 0);
      if (critter.startle > 0) set(x, y - 1, 0);
    };

    const tap = () => {
      pressed = false;
      const press = pressUnits;
      if (over(press)) {
        if (critter.asleep) wake();
        else {
          startHop(-0.7);
          critter.happy = Math.max(critter.happy, 40);
          heart();
        }
      } else if (crumbs.length < MAX_CRUMBS) {
        crumbs.push({
          x: clamp(press.x, bounds.min, bounds.max),
          y: Math.min(press.y, ground - 1),
          vy: 0,
          patience: CRUMB_PATIENCE,
          fade: CRUMB_FADE,
        });
        if (critter.asleep) wake();
      }
    };

    const step = () => {
      if (pressed) tap();

      if (!critter.asleep && pointer !== undefined && over(pointer)) {
        const dir = Math.sign(pointer.x - (seenPointerX ?? pointer.x));
        if (dir !== 0 && dir !== critter.lastDir) {
          critter.rubs[critter.rubSlot] = now;
          critter.rubSlot = (critter.rubSlot + 1) % RUBS_TO_DELIGHT;
          critter.lastDir = dir;
        }
      }
      seenPointerX = pointer?.x;
      if (rubbedEnough()) {
        critter.happy = 120;
        critter.rubs.fill(-Infinity);
      }
      if (critter.happy > 0) {
        critter.happy -= 1;
        if (critter.happy % 30 === 29) heart();
      }
      if (critter.startle > 0) critter.startle -= 1;

      for (let i = crumbs.length - 1; i >= 0; i -= 1) {
        const crumb = crumbs[i];
        crumb.x = clamp(crumb.x, bounds.min, bounds.max);
        if (crumb.y < ground - 1) {
          crumb.vy += 0.02;
          crumb.y = Math.min(crumb.y + crumb.vy, ground - 1);
        } else if (crumb.patience > 0 && !critter.asleep) {
          crumb.patience -= 1;
          if (crumb.patience === 0) startHop(-0.3);
        } else if (crumb.patience === 0 && (crumb.fade -= 1) <= 0) {
          crumbs.splice(i, 1);
        }
      }

      if (critter.asleep) {
        if (critter.breath < NAP_BREATH_STEPS) {
          critter.breath += 1;
          if (critter.breath % 110 === 0) {
            float(ZED, critter.x + 2, top() - 4);
          }
        }
      } else {
        let crumb: Crumb | undefined;
        for (const c of crumbs) {
          if (
            c.y >= ground - 1 &&
            c.patience > 0 &&
            (!crumb ||
              Math.abs(c.x - critter.x) < Math.abs(crumb.x - critter.x))
          ) {
            crumb = c;
          }
        }
        const target =
          crumb?.x ?? (pointer && clamp(pointer.x, bounds.min, bounds.max));
        if (
          target !== undefined &&
          Math.abs(target - critter.x) > ARRIVE_DISTANCE
        ) {
          critter.face = Math.sign(target - critter.x);
          critter.x +=
            critter.face * (critter.happy > 0 || crumb ? 0.28 : 0.18);
          critter.walk += 1;
        } else {
          critter.walk = 0;
          critter.face = pointer
            ? Math.sign(Math.round(pointer.x - critter.x))
            : 0;
        }
        if (crumb && Math.abs(crumb.x - critter.x) < EAT_DISTANCE) {
          crumbs.splice(crumbs.indexOf(crumb), 1);
          critter.happy = Math.max(critter.happy, 60);
          startHop(-0.6);
          heart();
        }
        const settled = crumbs.length === 0 && critter.happy <= 0;
        critter.drowsy =
          now - lastInputAt > LONELY_MS && settled ? critter.drowsy + 1 : 0;
        if (critter.drowsy > DROWSY_STEPS) nap();
      }

      critter.x = clamp(critter.x, bounds.min, bounds.max);
      if (critter.hop < 0 || critter.vy < 0) {
        critter.vy += 0.05;
        critter.hop += critter.vy;
        if (critter.hop >= 0) {
          critter.hop = 0;
          critter.vy = 0;
        }
      }
      for (let i = floaters.length - 1; i >= 0; i -= 1) {
        const bit = floaters[i];
        bit.life -= 1;
        bit.y -= 0.06;
        bit.x += Math.sin(bit.life / 14) * 0.03;
        if (bit.life <= 0) floaters.splice(i, 1);
      }
    };

    const render = () => {
      pixels.fill(0);
      for (let x = 0; x < unitsAcross; x += 1) plot(x, ground, 0.5);
      for (let x0 = 0; x0 < unitsAcross; x0 += TUFT_PERIOD) {
        for (let k = 0; k < TUFTS.length; k += 1) {
          plot(x0 + TUFTS[k], ground - 1, 0.35);
          if (k % 3 === 0) plot(x0 + TUFTS[k], ground - 2, 0.35);
        }
      }
      for (const crumb of crumbs) {
        plot(
          crumb.x,
          crumb.y,
          crumb.patience > 0 ? 0.85 : (0.85 * crumb.fade) / CRUMB_FADE,
        );
      }

      const left = Math.round(critter.x) - SPRITE_HALF_WIDTH;
      const y0 = top();
      if (critter.asleep) {
        const exhaling = Math.floor(critter.breath / 70) % 2 === 1;
        sprite(CURLED, left, y0, 1, 0, exhaling ? CURLED_EXHALE : undefined);
        set(left + 2, y0 + 2, 0.45);
        set(left + 5, y0 + 2, 0.45);
      } else {
        const striding =
          critter.walk > 0 && Math.floor(critter.walk / 7) % 2 === 1;
        sprite(STAND, left, y0, 1, 6, striding ? STRIDE_FEET : undefined);
        const lookUp =
          pointer !== undefined &&
          pointer.y < y0 - 4 &&
          Math.abs(pointer.x - critter.x) < 10;
        const eyeRow = y0 + (lookUp ? 2 : 3);
        const closed = critter.happy > 0 || now % BLINK_PERIOD_MS < BLINK_MS;
        eye(left + 2 + critter.face, eyeRow, closed);
        eye(left + 5 + critter.face, eyeRow, closed);
      }
      for (const bit of floaters) {
        sprite(bit.glyph, bit.x, bit.y, 0.65 * (bit.life / 150));
      }
      context.putImageData(image, 0, 0);
    };

    // An awake critter keeps stepping: that is how it runs down to its nap.
    const moving = () =>
      pressed ||
      !critter.asleep ||
      critter.breath < NAP_BREATH_STEPS ||
      floaters.length > 0;

    const tick = () => {
      frame = undefined;
      now = performance.now();
      pace.advance(now, step);
      render();
      if (moving()) frame = requestAnimationFrame(tick);
    };

    const wakeLoop = () => {
      if (frame !== undefined) return;
      pace.restart();
      frame = requestAnimationFrame(tick);
    };

    const touched = () => {
      lastInputAt = performance.now();
      wakeLoop();
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "touch") {
        pointer = toUnits(pointOn(canvas, event), pointerUnits);
      }
      touched();
    };

    const onDown = (event: PointerEvent) => {
      const point = pointOn(canvas, event);
      toUnits(point, pressUnits);
      pressed = true;
      if (event.pointerType !== "touch") pointer = toUnits(point, pointerUnits);
      touched();
    };

    const onLift = (event: PointerEvent) => {
      if (event.pointerType === "touch") pointer = undefined;
      touched();
    };

    const onLeave = () => {
      pointer = undefined;
      touched();
    };

    const onResize = () => {
      layout();
      wakeLoop();
    };

    layout();
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onLift);
    canvas.addEventListener("pointercancel", onLift);
    canvas.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", onResize);
    wakeLoop();

    return () => {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onLift);
      canvas.removeEventListener("pointercancel", onLift);
      canvas.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame ?? 0);
    };
  },
};
