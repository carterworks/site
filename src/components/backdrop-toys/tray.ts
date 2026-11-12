import { clamp } from "../../lib/clamp";
import {
  fixedStep,
  pointOn,
  TUNED_GRID,
  visibleCells,
  type Point,
  type Toy,
} from "./toy";

const BEARINGS = 50;
/** Sizes and speeds are in pixels of the tuned width, per 60 Hz step. */
const RADIUS = 1.5;
const PRESS_PULL = 0.06;
const HOVER_PULL = 0.012;
const ROLLING_FRICTION = 0.004;
const DRAG = 0.992;
/** Capped so a bearing moves well under its radius per substep, and cannot pass through another. */
const MAX_SPEED = 2;
const SUBSTEPS = 4;
/** One pass leaves a held pile shimmering as each push starts another overlap; two let it rest. */
const SOLVER_PASSES = 2;
const WALL_BOUNCE = 0.45;
const CLACK = 0.6;
/** Slower contacts do not bounce, so a pile held against a wall rests instead of buzzing. */
const REST_SPEED = 0.15;
const STOP_SPEED = 0.01;
/** A hand resting over the tray without pressing lets it level after this long. */
const HOVER_MS = 1200;
const STEP_MS = 1000 / 60;
/** A frame after a long pause, like a hidden tab, replays this much, not the whole gap. */
const MAX_CATCH_UP_MS = 100;

/**
 * A shallow tray of ball bearings, seen from above. Pressing tilts the tray
 * towards the pointer, further the nearer the edge, and the bearings roll
 * downhill, clacking off the walls and each other; hovering tilts it gently.
 * Let go and the tray levels, and rolling friction brings them to rest where
 * they are, so the toy goes still.
 *
 * It draws each bearing as a grey shaded disc with a highlight, its edge
 * antialiased by opacity, into its own image data put whole each frame.
 */
export const tray: Toy = {
  id: "tray",
  label: "Tray",
  look: { ghost: 20, noise: 6 },
  start(canvas) {
    const context = canvas.getContext("2d");
    if (context === null) return () => {};
    const { width, height } = canvas;
    const scale = width / TUNED_GRID;
    const radius = RADIUS * scale;
    const diameter = 2 * radius;
    const maxSpeed = MAX_SPEED * scale;
    const friction = (ROLLING_FRICTION * scale) / SUBSTEPS;
    const drag = DRAG ** (1 / SUBSTEPS);
    const stopSpeed = STOP_SPEED * scale;
    const restSpeed = REST_SPEED * scale;
    const image = context.createImageData(width, height);
    const pixels = image.data;
    const x = new Float64Array(BEARINGS);
    const y = new Float64Array(BEARINGS);
    const vx = new Float64Array(BEARINGS);
    const vy = new Float64Array(BEARINGS);
    // A bucket is a bearing's width, so any bearing it can touch is in a neighbouring one.
    const across = Math.ceil(width / diameter);
    const down = Math.ceil(height / diameter);
    const firstIn = new Int32Array(across * down);
    const nextIn = new Int32Array(BEARINGS);
    const pointer: Point = { x: 0, y: 0 };
    let visible = visibleCells(canvas);
    let held = false;
    let hovering = false;
    let movedAt = -Infinity;
    let deepest = 0;
    let settled = false;
    let now = 0;
    let frame: number | undefined;
    const pace = fixedStep(STEP_MS, MAX_CATCH_UP_MS);

    const scatter = () => {
      const w = visible.right - visible.left;
      const h = visible.bottom - visible.top;
      const columns = Math.ceil(Math.sqrt((BEARINGS * w) / h));
      const rows = Math.ceil(BEARINGS / columns);
      const cellW = w / columns;
      const cellH = h / rows;
      const slackX = Math.max(0, cellW - diameter);
      const slackY = Math.max(0, cellH - diameter);
      for (let k = 0; k < BEARINGS; k += 1) {
        x[k] =
          visible.left +
          (k % columns) * cellW +
          (cellW - slackX) / 2 +
          Math.random() * slackX;
        y[k] =
          visible.top +
          Math.floor(k / columns) * cellH +
          (cellH - slackY) / 2 +
          Math.random() * slackY;
      }
    };

    const rebound = (speed: number, restitution: number) =>
      Math.abs(speed) > restSpeed ? restitution : 0;

    const collide = (i: number, j: number) => {
      const dx = x[j] - x[i];
      const dy = y[j] - y[i];
      const gap = dx * dx + dy * dy;
      if (gap >= diameter * diameter) return;
      const distance = Math.sqrt(gap) || 1e-6;
      const nx = gap === 0 ? 1 : dx / distance;
      const ny = gap === 0 ? 0 : dy / distance;
      const overlap = diameter - distance;
      if (overlap > deepest) deepest = overlap;
      x[i] -= (nx * overlap) / 2;
      y[i] -= (ny * overlap) / 2;
      x[j] += (nx * overlap) / 2;
      y[j] += (ny * overlap) / 2;
      const closing = (vx[j] - vx[i]) * nx + (vy[j] - vy[i]) * ny;
      if (closing >= 0) return;
      const impulse = (-(1 + rebound(closing, CLACK)) * closing) / 2;
      vx[i] -= impulse * nx;
      vy[i] -= impulse * ny;
      vx[j] += impulse * nx;
      vy[j] += impulse * ny;
    };

    const bucketOf = (k: number) =>
      clamp(Math.floor(y[k] / diameter), 0, down - 1) * across +
      clamp(Math.floor(x[k] / diameter), 0, across - 1);

    const collideAll = () => {
      firstIn.fill(-1);
      for (let k = 0; k < BEARINGS; k += 1) {
        const bucket = bucketOf(k);
        nextIn[k] = firstIn[bucket];
        firstIn[bucket] = k;
      }
      for (let i = 0; i < BEARINGS; i += 1) {
        const bucket = bucketOf(i);
        const column = bucket % across;
        const row = (bucket - column) / across;
        for (
          let r = Math.max(0, row - 1);
          r <= Math.min(down - 1, row + 1);
          r += 1
        ) {
          for (
            let c = Math.max(0, column - 1);
            c <= Math.min(across - 1, column + 1);
            c += 1
          ) {
            for (let j = firstIn[r * across + c]; j !== -1; j = nextIn[j]) {
              if (j > i) collide(i, j);
            }
          }
        }
      }
    };

    const wall = (k: number) => {
      const left = visible.left + radius;
      const right = Math.max(left, visible.right - radius);
      const top = visible.top + radius;
      const bottom = Math.max(top, visible.bottom - radius);
      if (x[k] < left) {
        x[k] = left;
        if (vx[k] < 0) vx[k] *= -rebound(vx[k], WALL_BOUNCE);
      } else if (x[k] > right) {
        x[k] = right;
        if (vx[k] > 0) vx[k] *= -rebound(vx[k], WALL_BOUNCE);
      }
      if (y[k] < top) {
        y[k] = top;
        if (vy[k] < 0) vy[k] *= -rebound(vy[k], WALL_BOUNCE);
      } else if (y[k] > bottom) {
        y[k] = bottom;
        if (vy[k] > 0) vy[k] *= -rebound(vy[k], WALL_BOUNCE);
      }
    };

    const substep = (gx: number, gy: number) => {
      for (let k = 0; k < BEARINGS; k += 1) {
        vx[k] += gx;
        vy[k] += gy;
        const speed = Math.hypot(vx[k], vy[k]);
        if (speed > 0) {
          const slowed = Math.min(
            maxSpeed,
            Math.max(0, speed * drag - friction),
          );
          vx[k] *= slowed / speed;
          vy[k] *= slowed / speed;
        }
        x[k] += vx[k] / SUBSTEPS;
        y[k] += vy[k] / SUBSTEPS;
      }
      deepest = 0;
      for (let pass = 0; pass < SOLVER_PASSES; pass += 1) collideAll();
      for (let k = 0; k < BEARINGS; k += 1) wall(k);
    };

    const pull = () =>
      held ? PRESS_PULL : hovering && now - movedAt < HOVER_MS ? HOVER_PULL : 0;

    const advance = () => {
      const strength = pull();
      let gx = 0;
      let gy = 0;
      if (strength > 0) {
        const halfW = (visible.right - visible.left) / 2;
        const halfH = (visible.bottom - visible.top) / 2;
        gx = (pointer.x - visible.left - halfW) / halfW;
        gy = (pointer.y - visible.top - halfH) / halfH;
        const tilt = (strength * scale) / Math.max(1, Math.hypot(gx, gy));
        gx *= tilt / SUBSTEPS;
        gy *= tilt / SUBSTEPS;
      }
      for (let s = 0; s < SUBSTEPS; s += 1) substep(gx, gy);
      if (strength > 0) return;
      let fastest = 0;
      for (let k = 0; k < BEARINGS; k += 1) {
        fastest = Math.max(fastest, vx[k] * vx[k] + vy[k] * vy[k]);
      }
      if (fastest < stopSpeed * stopSpeed && deepest < 0.01) {
        vx.fill(0);
        vy.fill(0);
        settled = true;
      }
    };

    const paint = (k: number) => {
      const left = Math.max(0, Math.floor(x[k] - radius));
      const right = Math.min(width, Math.ceil(x[k] + radius));
      const top = Math.max(0, Math.floor(y[k] - radius));
      const bottom = Math.min(height, Math.ceil(y[k] + radius));
      for (let row = top; row < bottom; row += 1) {
        const v = (row + 0.5 - y[k]) / radius;
        for (let column = left; column < right; column += 1) {
          const u = (column + 0.5 - x[k]) / radius;
          const reach = u * u + v * v;
          const cover = clamp((1 - Math.sqrt(reach)) * radius + 0.5, 0, 1);
          if (cover === 0) continue;
          const facing = Math.sqrt(Math.max(0, 1 - reach));
          // Lit from the upper left, like the highlight.
          const light = clamp(-0.45 * u - 0.55 * v + 0.7 * facing, 0, 1);
          const glintU = u + 0.38;
          const glintV = v + 0.38;
          const glint = Math.max(
            0,
            1 - (glintU * glintU + glintV * glintV) / 0.12,
          );
          const i = (row * width + column) * 4;
          pixels[i] =
            pixels[i + 1] =
            pixels[i + 2] =
              50 + 150 * light + 255 * glint;
          pixels[i + 3] = cover * 255;
        }
      }
    };

    const draw = (time: number) => {
      frame = undefined;
      now = time;
      pace.advance(now, advance);
      pixels.fill(0);
      for (let k = 0; k < BEARINGS; k += 1) paint(k);
      context.putImageData(image, 0, 0);
      if (settled) pace.restart();
      else wake();
    };

    const wake = () => {
      settled = false;
      frame ??= requestAnimationFrame(draw);
    };

    const aim = (event: PointerEvent) => {
      Object.assign(pointer, pointOn(canvas, event));
      movedAt = performance.now();
      wake();
    };

    const onDown = (event: PointerEvent) => {
      held = true;
      aim(event);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch" && !held) return;
      hovering = true;
      aim(event);
    };

    const onLift = (event: PointerEvent) => {
      held = false;
      if (event.pointerType === "touch") hovering = false;
      aim(event);
    };

    const onLeave = () => {
      hovering = false;
    };

    const onResize = () => {
      visible = visibleCells(canvas);
      wake();
    };

    scatter();
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onLift);
    canvas.addEventListener("pointercancel", onLift);
    canvas.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", onResize);
    wake();

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onLift);
      canvas.removeEventListener("pointercancel", onLift);
      canvas.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame ?? 0);
    };
  },
};
