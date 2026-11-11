import { line } from "./line";
import type { CellRect, Mode, Point } from "./mode";

/** Steps between generations; a held press stretches them so a shape can be finished. */
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
const DISH_MARGIN = 2.5;

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
  holds: true,
  create({ columns, rows, random }) {
    const size = columns * rows;
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

    const seed = (x: number, y: number) => {
      x = Math.round(x);
      y = Math.round(y);
      if (x >= 0 && y >= 0 && x < columns && y < rows && dish[y * columns + x])
        cells[y * columns + x] = 1;
    };

    const fit = ({ left, top, right, bottom }: CellRect) => {
      const key = `${left} ${top} ${right} ${bottom}`;
      if (key === fitted) return;
      fitted = key;
      centreX = (left + right) / 2 - 0.5;
      centreY = (top + bottom) / 2 - 0.5;
      radiusX = (right - left) / 2 - DISH_MARGIN;
      radiusY = (bottom - top) / 2 - DISH_MARGIN;
      const rimX = radiusX + RIM_WIDTH;
      const rimY = radiusY + RIM_WIDTH;
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < columns; x += 1) {
          const dx = x - centreX;
          const dy = y - centreY;
          const i = y * columns + x;
          dish[i] = inside(dx, dy, radiusX, radiusY) ? 1 : 0;
          rim[i] = !dish[i] && inside(dx, dy, rimX, rimY) ? 1 : 0;
          if (!dish[i]) cells[i] = 0;
        }
      }
    };

    const spore = (now: number) => {
      const angle = random() * Math.PI * 2;
      const reach = Math.sqrt(random());
      const x = centreX + Math.cos(angle) * reach * Math.max(0, radiusX - 6);
      const y = centreY + Math.sin(angle) * reach * Math.max(0, radiusY - 6);
      for (let dy = -3; dy <= 3; dy += 1) {
        for (let dx = -3; dx <= 3; dx += 1) {
          if (random() < 0.45) seed(x + dx, y + dy);
        }
      }
      sporedAt = now;
      unchanged = 0;
    };

    const generation = () => {
      population = 0;
      for (let i = 0; i < size; i += 1) {
        if (!dish[i]) {
          next[i] = 0;
          continue;
        }
        const n =
          cells[i - 1] +
          cells[i + 1] +
          cells[i - columns] +
          cells[i + columns] +
          cells[i - columns - 1] +
          cells[i - columns + 1] +
          cells[i + columns - 1] +
          cells[i + columns + 1];
        next[i] = cells[i] ? +(n === 2 || n === 3) : +(n === 3);
        population += next[i];
      }
      [cells, next] = [next, cells];
      unchanged = population === previousPopulation ? unchanged + 1 : 0;
      previousPopulation = population;
    };

    const cellOf = ({ x, y }: Point) => ({
      x: Math.floor(x),
      y: Math.floor(y),
    });

    return {
      step({ pointer, press, visible, lastInputAt }, now) {
        fit(visible);
        awake = now - Math.max(lastInputAt, 0) < AWAKE_MS;

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
          line(last ?? cell, cell, (x, y) => {
            seed(x, y);
            if (random() < 0.5)
              seed(x + random() * 2 - 1, y + random() * 2 - 1);
          });
        }
        last = cell;
        hover = press?.held ? undefined : cell;

        if (awake) {
          clock += 1;
          if (
            clock >=
            (press?.held ? STEPS_PER_HELD_GENERATION : STEPS_PER_GENERATION)
          ) {
            clock = 0;
            generation();
            const quiet = now - Math.max(lastInputAt, 0) > SPORE_AFTER_IDLE_MS;
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
        for (let i = 0; i < size; i += 1) {
          if (cells[i]) trail[i] = 1;
          else if (trail[i] > 0) {
            trail[i] = trail[i] > TRAIL_FLOOR ? trail[i] * TRAIL_DECAY : 0;
            fading = true;
          }
        }
      },

      render(field) {
        for (let i = 0; i < size; i += 1) {
          field[i] = cells[i] ? 1 : rim[i] ? 0.4 : trail[i] * 0.4;
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
