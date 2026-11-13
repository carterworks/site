import { clamp } from "../../lib/clamp";
import { line } from "./line";
import {
  fixedStep,
  frameLoop,
  pointOn,
  sameRect,
  TUNED_GRID,
  visibleCells,
  type Point,
  type Toy,
} from "./toy";

/** In pixels at the tuned width; a bubble's radius is a share of it. */
const PITCH = 8;
const BUBBLE_SHARE = 0.4;
const ROW_SHARE = Math.sqrt(3) / 2;
/** Slightly past the rim, so a drag that grazes a bubble still pops it. */
const GRAB = 1.1;
const STEP_MS = 1000 / 60;
const MAX_CATCH_UP_MS = 100;
/** Steps in a pop: three looks, two steps each, then the flat ring stays. */
const POP_STEPS = 7;
const UNROLL_STEPS = 30;
const DOUBLE_TAP_MS = 350;
const RENEW_SHARE = 0.9;

/** How a bubble looks at each stage of popping, then flat: radius share, rim and fill opacity. */
const POP_LOOKS = [
  { radius: 1.2, rim: 255, fill: 110 },
  { radius: 1.05, rim: 170, fill: 0 },
  { radius: 0.9, rim: 110, fill: 0 },
];
const FLAT = { radius: 0.8, rim: 90, fill: 0 };

/**
 * A sheet of bubble wrap over the visible area. Pressing a bubble pops it,
 * and dragging while pressed pops each one the pointer crosses; hovering
 * does nothing. A pop flashes and collapses into a flat, crinkled ring that
 * stays. A double tap on a sheet that is almost all popped lays a fresh one,
 * which unrolls in from the left edge.
 *
 * Only a pop and the unroll animate; the loop sleeps otherwise. It draws
 * white on transparent, fading by alpha, into its own image data put whole
 * each frame.
 */
export const bubblewrap: Toy = {
  id: "bubblewrap",
  label: "Bubble wrap",
  look: { ghost: 45, noise: 8 },
  start(canvas) {
    const context = canvas.getContext("2d");
    if (context === null) return () => {};
    const { width, height } = canvas;
    const scale = width / TUNED_GRID;
    const pitch = PITCH * scale;
    const rowPitch = pitch * ROW_SHARE;
    const radius = pitch * BUBBLE_SHARE;
    const highlightRadius = Math.max(0.7, radius * 0.18);
    const image = context.createImageData(width, height);
    const pixels = image.data;
    const stepper = fixedStep(STEP_MS, MAX_CATCH_UP_MS);

    let visible = visibleCells(canvas);
    let columns = 0;
    let rows = 0;
    let left = 0;
    let top = 0;
    // 0 is intact, 1 to POP_STEPS - 1 is popping, POP_STEPS is flat.
    let age = new Uint8Array(0);
    let intact = 0;
    let popping = 0;
    let unrolled = UNROLL_STEPS;
    let drawing = true;
    let dragging = false;
    let lastTapAt = -Infinity;
    const lastTap: Point = { x: 0, y: 0 };
    const last: Point = { x: 0, y: 0 };

    const layOut = () => {
      const across = visible.right - visible.left;
      const down = visible.bottom - visible.top;
      columns = Math.max(1, Math.floor((across - pitch / 2) / pitch));
      rows = Math.max(1, Math.floor((down - pitch) / rowPitch) + 1);
      left =
        visible.left + (across - (columns * pitch + pitch / 2)) / 2 + pitch / 2;
      top =
        visible.top + (down - ((rows - 1) * rowPitch + pitch)) / 2 + pitch / 2;
      age = new Uint8Array(columns * rows);
      intact = age.length;
      popping = 0;
      unrolled = UNROLL_STEPS;
    };

    const plot = (x: number, y: number, opacity: number) => {
      const i = (y * width + x) * 4;
      if (opacity <= pixels[i + 3]) return;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      pixels[i + 3] = opacity;
    };

    const disc = (
      x: number,
      y: number,
      size: number,
      rim: number,
      fill: number,
      crinkle: number,
    ) => {
      const reach = Math.ceil(size + 1);
      const bottom = Math.min(height - 1, Math.floor(y) + reach);
      const right = Math.min(width - 1, Math.floor(x) + reach);
      for (
        let row = Math.max(0, Math.floor(y) - reach);
        row <= bottom;
        row += 1
      ) {
        for (
          let column = Math.max(0, Math.floor(x) - reach);
          column <= right;
          column += 1
        ) {
          const distance = Math.hypot(column + 0.5 - x, row + 0.5 - y);
          let opacity = distance < size ? fill : 0;
          // A one-pixel stroke covers a pixel by how near its centre is to the rim.
          let stroke = Math.max(0, 1 - Math.abs(distance - size)) * rim;
          // A flat ring is creased, which a hash of the pixel gives without an angle per pixel.
          if (crinkle > 0)
            stroke *=
              0.4 + (0.6 * ((column * 7 + row * 13 + crinkle * 31) & 7)) / 7;
          opacity = Math.max(opacity, stroke);
          if (opacity > 0) plot(column, row, opacity);
        }
      }
    };

    const highlight = (x: number, y: number) => {
      const reach = Math.ceil(highlightRadius + 1);
      const bottom = Math.min(height - 1, Math.floor(y) + reach);
      const right = Math.min(width - 1, Math.floor(x) + reach);
      for (
        let row = Math.max(0, Math.floor(y) - reach);
        row <= bottom;
        row += 1
      ) {
        for (
          let column = Math.max(0, Math.floor(x) - reach);
          column <= right;
          column += 1
        ) {
          const distance = Math.hypot(column + 0.5 - x, row + 0.5 - y);
          const cover = clamp(highlightRadius + 0.5 - distance, 0, 1);
          if (cover > 0) plot(column, row, cover * 255);
        }
      }
    };

    const render = () => {
      pixels.fill(0);
      const frontier =
        visible.left +
        (unrolled / UNROLL_STEPS) * (visible.right - visible.left + pitch);
      for (let row = 0; row < rows; row += 1) {
        const y = top + row * rowPitch;
        for (let column = 0; column < columns; column += 1) {
          const i = row * columns + column;
          const x = left + column * pitch + (row & 1) * (pitch / 2);
          const stage = age[i];
          if (stage === 0) {
            const size = radius * clamp((frontier - x) / pitch, 0, 1);
            if (size === 0) continue;
            disc(x, y, size, 200, 45, 0);
            highlight(x - size * 0.35, y - size * 0.35);
          } else if (stage === POP_STEPS) {
            disc(x, y, radius * FLAT.radius, FLAT.rim, FLAT.fill, i + 1);
          } else {
            const look = POP_LOOKS[Math.floor((stage - 1) / 2)];
            disc(x, y, radius * look.radius, look.rim, look.fill, i + 1);
          }
        }
      }
      context.putImageData(image, 0, 0);
    };

    const step = () => {
      if (popping > 0) {
        for (let i = 0; i < age.length; i += 1) {
          if (age[i] === 0 || age[i] === POP_STEPS) continue;
          age[i] += 1;
          if (age[i] === POP_STEPS) popping -= 1;
        }
        drawing = true;
      }
      if (unrolled < UNROLL_STEPS) {
        unrolled += 1;
        drawing = true;
      }
    };

    const draw = (now: number) => {
      stepper.advance(now, step);
      if (drawing) render();
      drawing = false;
      const animating = popping > 0 || unrolled < UNROLL_STEPS;
      if (!animating) stepper.restart();
      return animating;
    };

    const { wake, stop } = frameLoop(draw);

    const popAt = (x: number, y: number) => {
      if (unrolled < UNROLL_STEPS) return;
      const nearest = Math.round((y - top) / rowPitch);
      const first = Math.max(0, nearest - 1);
      const lastRow = Math.min(rows - 1, nearest + 1);
      for (let row = first; row <= lastRow; row += 1) {
        const offset = (row & 1) * (pitch / 2);
        const column = Math.round((x + 0.5 - left - offset) / pitch);
        if (column < 0 || column >= columns) continue;
        const i = row * columns + column;
        if (age[i] !== 0) continue;
        const reach = Math.hypot(
          x + 0.5 - (left + column * pitch + offset),
          y + 0.5 - (top + row * rowPitch),
        );
        if (reach > radius * GRAB) continue;
        age[i] = 1;
        intact -= 1;
        popping += 1;
        wake();
      }
    };

    const cell = (event: PointerEvent, into: Point) => {
      const point = pointOn(canvas, event);
      into.x = clamp(Math.floor(point.x), 0, width - 1);
      into.y = clamp(Math.floor(point.y), 0, height - 1);
    };

    const renew = () => {
      age.fill(0);
      intact = age.length;
      popping = 0;
      unrolled = 0;
      drawing = true;
      wake();
    };

    const isDoubleTap = (point: Point) => {
      const now = performance.now();
      const again =
        now - lastTapAt <= DOUBLE_TAP_MS &&
        Math.hypot(point.x - lastTap.x, point.y - lastTap.y) <= pitch;
      lastTapAt = again ? -Infinity : now;
      lastTap.x = point.x;
      lastTap.y = point.y;
      return again;
    };

    const onDown = (event: PointerEvent) => {
      cell(event, last);
      dragging = true;
      if (isDoubleTap(last) && intact <= age.length * (1 - RENEW_SHARE)) {
        renew();
        return;
      }
      popAt(last.x, last.y);
    };

    const next: Point = { x: 0, y: 0 };
    const onMove = (event: PointerEvent) => {
      if ((event.buttons & 1) === 0) {
        dragging = false;
        return;
      }
      cell(event, next);
      if (dragging) line(last, next, popAt);
      dragging = true;
      last.x = next.x;
      last.y = next.y;
    };

    const onLift = () => {
      dragging = false;
    };

    const onResize = () => {
      const now = visibleCells(canvas);
      if (sameRect(now, visible)) return;
      visible = now;
      layOut();
      drawing = true;
      wake();
    };

    layOut();
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
