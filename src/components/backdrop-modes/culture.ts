import { line } from "./line";
import type { CellRect, Mode, Point } from "./mode";

/**
 * The gallery tile this mode was tuned in draws cells about 6 px wide; the
 * site draws `columns` of them across about 1440 px. Every size and speed
 * below is in gallery cells and is scaled by this to the site's cell, so the
 * colony keeps the tile's size and pace in pixels. It is 1 at 240 columns.
 */
const GALLERY_CELL_PX = 6;
const REFERENCE_WIDTH_PX = 1440;
/** Steps between gallery generations; a held press stretches them so a shape can be finished. */
const STEPS_PER_GENERATION = 6;
const STEPS_PER_HELD_GENERATION = 36;
/** Per-step trail decay of a cell that died. */
const TRAIL_DECAY = 0.94;
const TRAIL_FLOOR = 0.01;
/**
 * A colony never settles on its own, so past this long since the last input
 * it is frozen mid-life: no spores, no generations, and the tab goes still.
 */
const AWAKE_MS = 20_000;
/** Spores wait out this much quiet so they never land under a drawing hand. */
const SPORE_AFTER_IDLE_MS = 2500;
const SPORE_COOLDOWN_MS = 1000;
const FADING_COLONY = 25;
const STALLED_GENERATIONS = 40;
const RIM_WIDTH = 1.2;
/** A thinner ring on a coarse grid steps diagonally and reads as dots. */
const MIN_RIM_WIDTH = 1.6;
const DISH_MARGIN = 2.5;
const SPORE_RADIUS = 3;
const SPORE_INSET = 6;

/** Whether an offset from the dish centre is inside the ellipse of these radii. */
function inside(dx: number, dy: number, radiusX: number, radiusY: number) {
  return (
    radiusX > 0 && radiusY > 0 && (dx / radiusX) ** 2 + (dy / radiusY) ** 2 < 1
  );
}

/**
 * Conway's life in a round dish with a rim. Drawing seeds cells; dead cells
 * leave a fading trail. The dish is the ellipse inscribed in the visible rect,
 * so the margins beside the page content hold live dish rather than corners.
 */
export const culture: Mode = {
  id: "culture",
  label: "Culture",
  look: { ghost: 70, noise: 0 },
  holds: true,
  create({ columns, rows, random }) {
    const size = columns * rows;
    const scale = (GALLERY_CELL_PX * columns) / REFERENCE_WIDTH_PX;
    const rimWidth = Math.max(MIN_RIM_WIDTH, RIM_WIDTH * scale);
    const dishMargin = DISH_MARGIN * scale;
    const sporeRadius = Math.round(SPORE_RADIUS * scale);
    const sporeInset = SPORE_INSET * scale;
    const stepsPerGeneration = Math.round(STEPS_PER_GENERATION / scale);
    const stepsPerHeldGeneration = Math.round(
      STEPS_PER_HELD_GENERATION / scale,
    );
    const dish = new Uint8Array(size);
    const rim = new Uint8Array(size);
    let cells = new Uint8Array(size);
    let next = new Uint8Array(size);
    const trail = new Float32Array(size);
    let centreX = 0;
    let centreY = 0;
    let radiusX = 0;
    let radiusY = 0;
    let fitted = "";
    let clock = 0;
    let population = 0;
    let previousPopulation = -1;
    let unchanged = 0;
    let sporedAt = -Infinity;
    let seenPress: object | undefined;
    let last: Point | undefined;
    let hover: Point | undefined;
    let fading = false;
    let awake = true;
    let arrivedAt: number | undefined;
    let rimCells = new Int32Array(0);
    /** Bounds of cells that may be alive; empty while `liveLeft > liveRight`. */
    let liveLeft = columns;
    let liveTop = rows;
    let liveRight = -1;
    let liveBottom = -1;
    /** Bounds of cells that are alive or still leave a trail. */
    let trailLeft = columns;
    let trailTop = rows;
    let trailRight = -1;
    let trailBottom = -1;

    const seed = (x: number, y: number) => {
      x = Math.round(x);
      y = Math.round(y);
      if (
        x >= 0 &&
        y >= 0 &&
        x < columns &&
        y < rows &&
        dish[y * columns + x]
      ) {
        cells[y * columns + x] = 1;
        liveLeft = Math.min(liveLeft, x);
        liveTop = Math.min(liveTop, y);
        liveRight = Math.max(liveRight, x);
        liveBottom = Math.max(liveBottom, y);
      }
    };

    const fit = ({ left, top, right, bottom }: CellRect) => {
      const key = `${left} ${top} ${right} ${bottom}`;
      if (key === fitted) return;
      fitted = key;
      centreX = (left + right) / 2 - 0.5;
      centreY = (top + bottom) / 2 - 0.5;
      radiusX = (right - left) / 2 - dishMargin;
      radiusY = (bottom - top) / 2 - dishMargin;
      const rimX = radiusX + rimWidth;
      const rimY = radiusY + rimWidth;
      const rimIndexes: number[] = [];
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < columns; x += 1) {
          const dx = x - centreX;
          const dy = y - centreY;
          const i = y * columns + x;
          dish[i] = inside(dx, dy, radiusX, radiusY) ? 1 : 0;
          rim[i] = !dish[i] && inside(dx, dy, rimX, rimY) ? 1 : 0;
          if (!dish[i]) cells[i] = 0;
          if (rim[i]) rimIndexes.push(i);
        }
      }
      rimCells = Int32Array.from(rimIndexes);
    };

    const spore = (now: number) => {
      const angle = random() * Math.PI * 2;
      const reach = Math.sqrt(random());
      const x =
        centreX + Math.cos(angle) * reach * Math.max(0, radiusX - sporeInset);
      const y =
        centreY + Math.sin(angle) * reach * Math.max(0, radiusY - sporeInset);
      for (let dy = -sporeRadius; dy <= sporeRadius; dy += 1) {
        for (let dx = -sporeRadius; dx <= sporeRadius; dx += 1) {
          if (random() < 0.45) seed(x + dx, y + dy);
        }
      }
      sporedAt = now;
      unchanged = 0;
    };

    const generation = () => {
      population = 0;
      next.fill(0);
      const left = Math.max(liveLeft - 1, 0);
      const top = Math.max(liveTop - 1, 0);
      const right = Math.min(liveRight + 1, columns - 1);
      const bottom = Math.min(liveBottom + 1, rows - 1);
      liveLeft = columns;
      liveTop = rows;
      liveRight = -1;
      liveBottom = -1;
      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          const i = y * columns + x;
          if (!dish[i]) continue;
          const n =
            cells[i - 1] +
            cells[i + 1] +
            cells[i - columns] +
            cells[i + columns] +
            cells[i - columns - 1] +
            cells[i - columns + 1] +
            cells[i + columns - 1] +
            cells[i + columns + 1];
          if (!(cells[i] ? n === 2 || n === 3 : n === 3)) continue;
          next[i] = 1;
          population += 1;
          liveLeft = Math.min(liveLeft, x);
          liveTop = Math.min(liveTop, y);
          liveRight = Math.max(liveRight, x);
          liveBottom = Math.max(liveBottom, y);
        }
      }
      [cells, next] = [next, cells];
      unchanged = population === previousPopulation ? unchanged + 1 : 0;
      previousPopulation = population;
    };

    const cellOf = ({ x, y }: Point) => ({
      x: Math.floor(x),
      y: Math.floor(y),
    });

    const scatter = (x: number, y: number) => {
      seed(x, y);
      if (random() < 0.5)
        seed(x + (random() * 2 - 1) * scale, y + (random() * 2 - 1) * scale);
    };

    return {
      step({ pointer, press, visible, lastInputAt }, now) {
        fit(visible);
        arrivedAt ??= now;
        const lastActive = Math.max(lastInputAt, arrivedAt);
        awake = now - lastActive < AWAKE_MS;

        const cell = pointer && cellOf(pointer);
        if (press !== undefined && press !== seenPress) {
          seenPress = press;
          const x = Math.floor(press.x);
          const y = Math.floor(press.y);
          seed(x, y);
          seed(x + 1, y);
          seed(x, y + 1);
        }
        if (press?.held && cell !== undefined) {
          line(last ?? cell, cell, scatter);
        }
        last = cell;
        hover = press?.held ? undefined : cell;

        if (awake) {
          clock += 1;
          if (
            clock >= (press?.held ? stepsPerHeldGeneration : stepsPerGeneration)
          ) {
            clock = 0;
            generation();
            const quiet = now - lastActive > SPORE_AFTER_IDLE_MS;
            if (
              quiet &&
              now - sporedAt > SPORE_COOLDOWN_MS &&
              (population < FADING_COLONY || unchanged > STALLED_GENERATIONS)
            ) {
              spore(now);
            }
          }
        }

        fading = false;
        const left = Math.min(trailLeft, liveLeft);
        const top = Math.min(trailTop, liveTop);
        const right = Math.max(trailRight, liveRight);
        const bottom = Math.max(trailBottom, liveBottom);
        trailLeft = columns;
        trailTop = rows;
        trailRight = -1;
        trailBottom = -1;
        for (let y = top; y <= bottom; y += 1) {
          for (let x = left; x <= right; x += 1) {
            const i = y * columns + x;
            if (cells[i]) trail[i] = 1;
            else if (trail[i] > 0) {
              trail[i] = trail[i] > TRAIL_FLOOR ? trail[i] * TRAIL_DECAY : 0;
              fading = true;
            }
            if (trail[i] > 0) {
              trailLeft = Math.min(trailLeft, x);
              trailTop = Math.min(trailTop, y);
              trailRight = Math.max(trailRight, x);
              trailBottom = Math.max(trailBottom, y);
            }
          }
        }
      },

      render(field) {
        for (const i of rimCells) field[i] = 0.4;
        for (let y = trailTop; y <= trailBottom; y += 1) {
          for (let x = trailLeft; x <= trailRight; x += 1) {
            const i = y * columns + x;
            field[i] = cells[i] ? 1 : rim[i] ? 0.4 : trail[i] * 0.4;
          }
        }
        if (
          hover !== undefined &&
          hover.x >= 0 &&
          hover.y >= 0 &&
          hover.x < columns &&
          hover.y < rows
        ) {
          const i = hover.y * columns + hover.x;
          if (dish[i] && !cells[i]) field[i] = 0.6;
        }
      },

      pace: () => (awake || fading ? "active" : "still"),
    };
  },
};
