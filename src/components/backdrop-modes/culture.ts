import { line } from "./line";
import {
  pointOn,
  sameRect,
  visibleCells,
  type CellRect,
  type Point,
  type Toy,
} from "./toy";

/**
 * The gallery tile this toy was tuned in draws cells about 6 px wide, 240 of
 * them across 1440 px. Every size and speed below is in gallery cells and is
 * scaled by `canvas.width / GALLERY_COLUMNS` to the canvas's cell, so the
 * colony keeps the tile's size and pace on screen. The scale is 1 at 240
 * columns.
 */
const GALLERY_COLUMNS = 240;
/** Steps between gallery generations; a held press stretches them so a shape can be finished. */
const STEPS_PER_GENERATION = 6;
const STEPS_PER_HELD_GENERATION = 36;
/** Colony steps run at a fixed rate, so it keeps its pace at any refresh rate. */
const STEP_MS = 1000 / 60;
/** Time the colony may catch up after a stall, so a long pause doesn't replay in a burst. */
const MAX_CATCH_UP_MS = 250;
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
/** Smaller than a cell the jitter rounds back onto the stroke and it stays one cell thin. */
const MIN_SCATTER = 1.5;
const DISH_MARGIN = 2.5;
const SPORE_RADIUS = 3;
const SPORE_INSET = 6;
const RIM_LEVEL = 0.4;
const TRAIL_LEVEL = 0.4;
const CURSOR_LEVEL = 0.6;

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
 *
 * It draws white on transparent, fading by alpha, into its own image data put
 * whole each frame, though only the box where cells changed is repainted.
 */
export const culture: Toy = {
  id: "culture",
  label: "Culture",
  look: { ghost: 70, noise: 0 },
  start(canvas) {
    const context = canvas.getContext("2d");
    if (context === null) return () => {};
    const { width: columns, height: rows } = canvas;
    const size = columns * rows;
    const scale = columns / GALLERY_COLUMNS;
    const rimWidth = Math.max(MIN_RIM_WIDTH, RIM_WIDTH * scale);
    const dishMargin = DISH_MARGIN * scale;
    const sporeRadius = Math.round(SPORE_RADIUS * scale);
    const sporeInset = SPORE_INSET * scale;
    const stepsPerGeneration = Math.round(STEPS_PER_GENERATION / scale);
    const stepsPerHeldGeneration = Math.round(
      STEPS_PER_HELD_GENERATION / scale,
    );
    const scatterReach = Math.max(MIN_SCATTER, scale);

    const image = context.createImageData(columns, rows);
    const pixels = image.data;
    pixels.fill(255);
    const dish = new Uint8Array(size);
    const rim = new Uint8Array(size);
    let cells = new Uint8Array(size);
    let next = new Uint8Array(size);
    const trail = new Float32Array(size);
    let centreX = 0;
    let centreY = 0;
    let radiusX = 0;
    let radiusY = 0;
    let fitted: CellRect | undefined;

    let time = 0;
    let lastTick: number | undefined;
    let accumulated = 0;
    let frame: number | undefined;
    let clock = 0;
    let population = 0;
    let previousPopulation = -1;
    let unchanged = 0;
    let sporedAt = -Infinity;
    let lastInputAt = 0;
    let awake = true;
    let fading = false;

    const cell: Point = { x: 0, y: 0 };
    const last: Point = { x: 0, y: 0 };
    const pressed: Point = { x: 0, y: 0 };
    let hasPointer = false;
    let hasLast = false;
    let held = false;
    let pressPending = false;
    let hovering = false;
    let hover = -1;

    // Bounds of cells that may be alive; empty while `liveLeft > liveRight`.
    let liveLeft = columns;
    let liveTop = rows;
    let liveRight = -1;
    let liveBottom = -1;
    // Bounds of cells that are alive or still leave a trail.
    let trailLeft = columns;
    let trailTop = rows;
    let trailRight = -1;
    let trailBottom = -1;
    // Bounds of cells whose pixels are stale; repainted by the next frame.
    let dirtyLeft = 0;
    let dirtyTop = 0;
    let dirtyRight = columns - 1;
    let dirtyBottom = rows - 1;

    const markDirty = (x: number, y: number) => {
      dirtyLeft = Math.min(dirtyLeft, x);
      dirtyTop = Math.min(dirtyTop, y);
      dirtyRight = Math.max(dirtyRight, x);
      dirtyBottom = Math.max(dirtyBottom, y);
    };

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

    const fit = () => {
      const visible = visibleCells(canvas);
      if (fitted !== undefined && sameRect(fitted, visible)) return;
      fitted = visible;
      const { left, top, right, bottom } = visible;
      centreX = (left + right) / 2 - 0.5;
      centreY = (top + bottom) / 2 - 0.5;
      radiusX = (right - left) / 2 - dishMargin;
      radiusY = (bottom - top) / 2 - dishMargin;
      const rimX = radiusX + rimWidth;
      const rimY = radiusY + rimWidth;
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
      dirtyLeft = 0;
      dirtyTop = 0;
      dirtyRight = columns - 1;
      dirtyBottom = rows - 1;
    };

    const spore = () => {
      const angle = Math.random() * Math.PI * 2;
      const reach = Math.sqrt(Math.random());
      const x =
        centreX + Math.cos(angle) * reach * Math.max(0, radiusX - sporeInset);
      const y =
        centreY + Math.sin(angle) * reach * Math.max(0, radiusY - sporeInset);
      for (let dy = -sporeRadius; dy <= sporeRadius; dy += 1) {
        for (let dx = -sporeRadius; dx <= sporeRadius; dx += 1) {
          if (Math.random() < 0.45) seed(x + dx, y + dy);
        }
      }
      sporedAt = time;
      unchanged = 0;
    };

    const generation = () => {
      population = 0;
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
      // `next` is the old generation, which lives only inside the box swept above.
      for (let y = top; y <= bottom; y += 1) {
        next.fill(0, y * columns + left, y * columns + right + 1);
      }
      unchanged = population === previousPopulation ? unchanged + 1 : 0;
      previousPopulation = population;
    };

    const scatter = (x: number, y: number) => {
      seed(x, y);
      if (Math.random() >= 0.5) return;
      for (let i = 0; i < 2; i += 1) {
        seed(
          x + (Math.random() * 2 - 1) * scatterReach,
          y + (Math.random() * 2 - 1) * scatterReach,
        );
      }
    };

    const step = () => {
      awake = time - lastInputAt < AWAKE_MS;

      if (pressPending) {
        pressPending = false;
        seed(pressed.x, pressed.y);
        seed(pressed.x + 1, pressed.y);
        seed(pressed.x, pressed.y + 1);
      }
      if (held && hasPointer) line(hasLast ? last : cell, cell, scatter);
      hasLast = hasPointer;
      if (hasLast) {
        last.x = cell.x;
        last.y = cell.y;
      }
      hovering = hasLast && !held;

      if (awake) {
        clock += 1;
        if (clock >= (held ? stepsPerHeldGeneration : stepsPerGeneration)) {
          clock = 0;
          generation();
          const quiet = time - lastInputAt > SPORE_AFTER_IDLE_MS;
          if (
            quiet &&
            time - sporedAt > SPORE_COOLDOWN_MS &&
            (population < FADING_COLONY || unchanged > STALLED_GENERATIONS)
          ) {
            spore();
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
      if (left <= right && top <= bottom) {
        markDirty(left, top);
        markDirty(right, bottom);
      }
    };

    const advance = (now: number) => {
      const elapsed =
        lastTick === undefined
          ? STEP_MS
          : Math.min(now - lastTick, MAX_CATCH_UP_MS);
      lastTick = now;
      accumulated += elapsed;
      while (accumulated >= STEP_MS) {
        accumulated -= STEP_MS;
        time += STEP_MS;
        step();
      }
    };

    const cursor = () => {
      if (
        !hovering ||
        last.x < 0 ||
        last.y < 0 ||
        last.x >= columns ||
        last.y >= rows
      ) {
        return -1;
      }
      const i = last.y * columns + last.x;
      return dish[i] && !cells[i] ? i : -1;
    };

    const draw = () => {
      const shown = cursor();
      if (shown !== hover) {
        if (hover >= 0) markDirty(hover % columns, Math.floor(hover / columns));
        if (shown >= 0) markDirty(shown % columns, Math.floor(shown / columns));
        hover = shown;
      }
      for (let y = dirtyTop; y <= dirtyBottom; y += 1) {
        for (let x = dirtyLeft; x <= dirtyRight; x += 1) {
          const i = y * columns + x;
          let level = 0;
          if (cells[i]) level = 1;
          else if (i === hover) level = CURSOR_LEVEL;
          else if (trail[i] > 0) level = trail[i] * TRAIL_LEVEL;
          else if (rim[i]) level = RIM_LEVEL;
          pixels[i * 4 + 3] = level * 255;
        }
      }
      dirtyLeft = columns;
      dirtyTop = rows;
      dirtyRight = -1;
      dirtyBottom = -1;
      context.putImageData(image, 0, 0);
    };

    const tick = (now: number) => {
      frame = undefined;
      advance(now);
      draw();
      if (awake || fading) wake();
      else lastTick = undefined;
    };

    const wake = () => {
      frame ??= requestAnimationFrame(tick);
    };

    const touched = () => {
      lastInputAt = time;
      wake();
    };

    const onMove = (event: PointerEvent) => {
      const point = pointOn(canvas, event);
      cell.x = Math.floor(point.x);
      cell.y = Math.floor(point.y);
      hasPointer = true;
      touched();
    };

    const onDown = (event: PointerEvent) => {
      const point = pointOn(canvas, event);
      pressed.x = Math.floor(point.x);
      pressed.y = Math.floor(point.y);
      pressPending = true;
      held = true;
      // A finger lands somewhere new, so its first move must not join on to the last.
      if (event.pointerType === "touch") hasPointer = false;
      touched();
    };

    const onLift = (event: PointerEvent) => {
      held = false;
      if (event.pointerType === "touch") hasPointer = false;
      wake();
    };

    const onLeave = () => {
      hasPointer = false;
      wake();
    };

    const onResize = () => {
      fit();
      wake();
    };

    fit();
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onLift);
    canvas.addEventListener("pointercancel", onLift);
    canvas.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", onResize);
    wake();

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
