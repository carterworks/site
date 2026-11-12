import { line } from "./line";
import {
  fixedStep,
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
/** Smaller than a cell the jitter rounds back onto the stroke and it stays one cell thin. */
const MIN_SCATTER = 1.5;
const SPORE_RADIUS = 3;
const TRAIL_LEVEL = 0.4;
const CURSOR_LEVEL = 0.6;

/**
 * Conway's life across the whole visible region. Drawing seeds cells; dead
 * cells leave a fading trail. Cells beyond the region's edge count as dead, so
 * a colony meets the edge and dies there rather than wrapping round.
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
    const sporeRadius = Math.round(SPORE_RADIUS * scale);
    const stepsPerGeneration = Math.round(STEPS_PER_GENERATION / scale);
    const stepsPerHeldGeneration = Math.round(
      STEPS_PER_HELD_GENERATION / scale,
    );
    const scatterReach = Math.max(MIN_SCATTER, scale);

    const image = context.createImageData(columns, rows);
    const pixels = image.data;
    pixels.fill(255);
    let cells = new Uint8Array(size);
    let next = new Uint8Array(size);
    const trail = new Float32Array(size);
    // Inclusive bounds of the cells that touch the visible region.
    let regionLeft = 0;
    let regionTop = 0;
    let regionRight = columns - 1;
    let regionBottom = rows - 1;
    let fitted: CellRect | undefined;

    let time = 0;
    const pace = fixedStep(STEP_MS, MAX_CATCH_UP_MS);
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

    const inRegion = (x: number, y: number) =>
      x >= regionLeft &&
      x <= regionRight &&
      y >= regionTop &&
      y <= regionBottom;

    const seed = (x: number, y: number) => {
      x = Math.round(x);
      y = Math.round(y);
      if (inRegion(x, y)) {
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
      regionLeft = Math.floor(visible.left);
      regionTop = Math.floor(visible.top);
      regionRight = Math.ceil(visible.right) - 1;
      regionBottom = Math.ceil(visible.bottom) - 1;
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < columns; x += 1) {
          if (!inRegion(x, y)) cells[y * columns + x] = 0;
        }
      }
      dirtyLeft = 0;
      dirtyTop = 0;
      dirtyRight = columns - 1;
      dirtyBottom = rows - 1;
    };

    const spore = () => {
      const x =
        regionLeft + Math.floor(Math.random() * (regionRight - regionLeft + 1));
      const y =
        regionTop + Math.floor(Math.random() * (regionBottom - regionTop + 1));
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
      const left = Math.max(liveLeft - 1, regionLeft);
      const top = Math.max(liveTop - 1, regionTop);
      const right = Math.min(liveRight + 1, regionRight);
      const bottom = Math.min(liveBottom + 1, regionBottom);
      liveLeft = columns;
      liveTop = rows;
      liveRight = -1;
      liveBottom = -1;
      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          const i = y * columns + x;
          const west = x > 0;
          const east = x < columns - 1;
          let n = 0;
          if (west) n += cells[i - 1];
          if (east) n += cells[i + 1];
          if (y > 0) {
            n += cells[i - columns];
            if (west) n += cells[i - columns - 1];
            if (east) n += cells[i - columns + 1];
          }
          if (y < rows - 1) {
            n += cells[i + columns];
            if (west) n += cells[i + columns - 1];
            if (east) n += cells[i + columns + 1];
          }
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

    const advanceClock = () => {
      time += STEP_MS;
      step();
    };

    const cursor = () => {
      if (!hovering || !inRegion(last.x, last.y)) return -1;
      const i = last.y * columns + last.x;
      return cells[i] ? -1 : i;
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
      pace.advance(now, advanceClock);
      draw();
      if (awake || fading) wake();
      else pace.restart();
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
