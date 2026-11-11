import { clamp } from "../emulated-canvas-limits";
import type { CellRect, Mode, Point } from "./mode";

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

const SPRITE_HALF_WIDTH = 4;
/** Keeps the sprite's whole body, not only its centre, inside the visible span. */
const EDGE_MARGIN = SPRITE_HALF_WIDTH + 1;
/** Rows between the ground line and the bottom of the viewport. */
const GROUND_INSET = 3;

const MAX_CRUMBS = 6;
const EAT_DISTANCE = 1.5;
const ARRIVE_DISTANCE = 1.2;
const CRUMB_PATIENCE = 480;
const CRUMB_FADE = 40;
const RUB_WINDOW_MS = 900;
const RUBS_TO_DELIGHT = 4;
const LONELY_MS = 7000;
const DROWSY_STEPS = 120;
/** A multiple of the 140-step breath, so the sleeper freezes inhaled. */
const NAP_BREATH_STEPS = 420;
const BLINK_PERIOD_MS = 3400;
const BLINK_MS = 130;

/**
 * Where the critter can stand. Crumbs land inside it too, so a crumb can never
 * be somewhere the critter cannot walk.
 */
function reach({ left, right }: CellRect) {
  const min = left + EDGE_MARGIN;
  return { min, max: Math.max(min, right - EDGE_MARGIN) };
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
 */
export const mote: Mode = {
  id: "mote",
  label: "Mote",
  create({ columns, rows }) {
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
      rubs: [] as number[],
    };
    const crumbs: Crumb[] = [];
    const floaters: Floater[] = [];
    let pointer: Point | undefined;
    let seenPress: object | undefined;
    let seenPointerX: number | undefined;
    let placed = false;
    let ground = 0;
    let now = 0;
    let walking = false;

    const top = () =>
      ground -
      (critter.asleep ? CURLED.length : STAND.length) +
      Math.round(critter.hop);
    const over = (p: Point) =>
      Math.abs(p.x - critter.x) < 6 && p.y > top() - 2 && p.y < ground + 1;
    const float = (glyph: string[], x: number, y: number) =>
      floaters.push({ glyph, x, y, life: 150 });
    const heart = () => float(HEART, critter.x - 2, top() - 6);
    const wake = () => {
      critter.asleep = false;
      critter.vy = -0.8;
      critter.startle = 40;
      critter.drowsy = 0;
    };
    const nap = () => {
      critter.asleep = true;
      critter.breath = 0;
    };

    return {
      step({ pointer: hover, press, lastInputAt, visible }, time) {
        now = time;
        pointer = hover;
        ground = Math.floor(visible.bottom) - GROUND_INSET;
        const bounds = reach(visible);
        if (!placed) {
          critter.x = bounds.min + 0.62 * (bounds.max - bounds.min);
          placed = true;
        }

        if (press !== undefined && press !== seenPress) {
          seenPress = press;
          if (over(press)) {
            if (critter.asleep) wake();
            else {
              if (critter.hop === 0) critter.vy = -0.7;
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
        }

        if (!critter.asleep && pointer !== undefined && over(pointer)) {
          const dir = Math.sign(pointer.x - (seenPointerX ?? pointer.x));
          if (dir !== 0 && dir !== critter.lastDir) {
            critter.rubs.push(now);
            critter.lastDir = dir;
          }
        }
        seenPointerX = pointer?.x;
        critter.rubs = critter.rubs.filter((at) => now - at < RUB_WINDOW_MS);
        if (critter.rubs.length >= RUBS_TO_DELIGHT) {
          critter.happy = 120;
          critter.rubs = [];
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
            if (crumb.patience === 0 && critter.vy === 0) critter.vy = -0.3;
          } else if (crumb.patience === 0 && (crumb.fade -= 1) <= 0) {
            crumbs.splice(i, 1);
          }
        }

        walking = false;
        if (critter.asleep) {
          if (critter.breath < NAP_BREATH_STEPS) {
            critter.breath += 1;
            if (critter.breath % 110 === 0) {
              float(ZED, critter.x + 2, top() - 4);
            }
          }
        } else {
          const crumb = crumbs
            .filter((c) => c.y >= ground - 1 && c.patience > 0)
            .sort(
              (a, b) => Math.abs(a.x - critter.x) - Math.abs(b.x - critter.x),
            )[0];
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
            walking = true;
          } else {
            critter.walk = 0;
            critter.face = pointer
              ? Math.sign(Math.round(pointer.x - critter.x))
              : 0;
          }
          if (crumb && Math.abs(crumb.x - critter.x) < EAT_DISTANCE) {
            crumbs.splice(crumbs.indexOf(crumb), 1);
            critter.happy = Math.max(critter.happy, 60);
            critter.vy = -0.6;
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
      },

      render(field) {
        const plot = (x: number, y: number, value: number) => {
          const cx = Math.round(x);
          const cy = Math.round(y);
          if (cx < 0 || cy < 0 || cx >= columns || cy >= rows) return;
          const i = cy * columns + cx;
          if (field[i] < value) field[i] = value;
        };
        const set = (x: number, y: number, value: number) => {
          const cx = Math.round(x);
          const cy = Math.round(y);
          if (cx >= 0 && cy >= 0 && cx < columns && cy < rows) {
            field[cy * columns + cx] = value;
          }
        };
        const sprite = (glyph: string[], x: number, y: number, value: number) =>
          glyph.forEach((row, r) =>
            [...row].forEach((cell, k) => {
              if (cell === "#") plot(x + k, y + r, value);
            }),
          );

        for (let x = 0; x < columns; x += 1) plot(x, ground, 0.5);
        TUFTS.forEach((x, k) => {
          plot(x, ground - 1, 0.35);
          if (k % 3 === 0) plot(x, ground - 2, 0.35);
        });
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
          const glyph = [...CURLED];
          if (Math.floor(critter.breath / 70) % 2) glyph[0] = CURLED_EXHALE;
          sprite(glyph, left, y0, 1);
          set(left + 2, y0 + 2, 0.45);
          set(left + 5, y0 + 2, 0.45);
        } else {
          const glyph = [...STAND];
          if (critter.walk && Math.floor(critter.walk / 7) % 2) {
            glyph[6] = STRIDE_FEET;
          }
          sprite(glyph, left, y0, 1);
          const lookUp =
            pointer !== undefined &&
            pointer.y < y0 - 4 &&
            Math.abs(pointer.x - critter.x) < 10;
          const eyeRow = y0 + (lookUp ? 2 : 3);
          const closed = critter.happy > 0 || now % BLINK_PERIOD_MS < BLINK_MS;
          for (const column of [2, 5]) {
            const eyeX = left + column + critter.face;
            set(eyeX, eyeRow, closed ? 0.45 : 0);
            if (critter.startle > 0) set(eyeX, eyeRow - 1, 0);
          }
        }
        for (const bit of floaters) {
          sprite(bit.glyph, bit.x, bit.y, 0.65 * (bit.life / 150));
        }
      },

      pace() {
        if (critter.asleep) {
          return critter.breath < NAP_BREATH_STEPS || floaters.length > 0
            ? "idle"
            : "still";
        }
        const busy =
          walking ||
          critter.hop !== 0 ||
          critter.vy !== 0 ||
          critter.happy > 0 ||
          critter.startle > 0 ||
          crumbs.length > 0 ||
          floaters.length > 0;
        return busy ? "active" : "idle";
      },
    };
  },
};
