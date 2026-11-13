import {
  fixedStep,
  frameLoop,
  pointOn,
  visibleCells,
  type Point,
  type Toy,
} from "./toy";

const ROWS = 12;
const MIN_COLUMNS = 5;
const MAX_COLUMNS = 40;
/** Shares of the visible rect the cloth spans at rest, before gravity stretches it. */
const WIDTH_SHARE = 0.9;
const HEIGHT_SHARE = 0.72;
const TOP_SHARE = 0.06;
/** The rod holds the top edge this much narrower than the cloth, which gathers it into pleats. */
const GATHER = 0.7;
/** In vertical rest lengths per step², close to real gravity for a curtain a couple of metres long. */
const GRAVITY = 0.02;
const DAMPING = 0.98;
const ITERATIONS = 3;
/** Fastest point movement, in vertical rest lengths per step, that counts as still. */
const STILL = 0.002;
/** Steps the cloth gets to fall into place before it is first drawn. */
const SETTLE_STEPS = 2000;
/** Steps in a row the cloth must stay that still, so a swing turning round is not taken for rest. */
const CALM_STEPS = 30;
/** How far the pointer reaches, in vertical rest lengths. */
const BRUSH_RADIUS = 2.5;
const GRAB_REACH = 2;
/** The share of the pointer's movement a point right under it takes on as speed. */
const BRUSH = 0.15;
/** Light falling from the upper left, in front of the cloth; +z faces the viewer. */
const LIGHT = { x: -0.55, y: -0.35, z: 0.76 };
const AMBIENT = 0.25;
const SHADES = 8;
const STEP_MS = 1000 / 60;
const MAX_CATCH_UP_MS = 100;

/**
 * A curtain hanging from a rod across the top, gathered into soft pleats. A
 * hovering pointer brushes the cloth along the way it moves; a press grabs
 * the nearest point of it to drag about, and letting go lets it swing back.
 * Left alone, it comes to rest and the loop stops.
 *
 * It is a Verlet mesh of points, drawn white on transparent, each pixel's
 * alpha the light its fold catches, into its own image data put whole.
 */
export const curtain: Toy = {
  id: "curtain",
  label: "Curtain",
  look: { ghost: 40, noise: 8 },
  start(canvas) {
    const context = canvas.getContext("2d");
    if (context === null) return () => {};
    const { width, height } = canvas;
    const image = context.createImageData(width, height);
    const pixels = image.data;
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
    }
    const count = MAX_COLUMNS * ROWS;
    const x = new Float32Array(count);
    const y = new Float32Array(count);
    const z = new Float32Array(count);
    const previousX = new Float32Array(count);
    const previousY = new Float32Array(count);
    const previousZ = new Float32Array(count);
    const shade = new Float32Array(count);
    const pace = fixedStep(STEP_MS, MAX_CATCH_UP_MS);
    const pointer: Point = { x: 0, y: 0 };
    const grabOffset: Point = { x: 0, y: 0 };
    let columns = 0;
    let restX = 0;
    let restY = 0;
    let hovering = false;
    let grabbed = -1;
    let still = true;
    let calm = 0;

    const hang = () => {
      const visible = visibleCells(canvas);
      const spanX = (visible.right - visible.left) * WIDTH_SHARE;
      const spanY = (visible.bottom - visible.top) * HEIGHT_SHARE;
      restY = spanY / (ROWS - 1);
      columns = Math.min(
        MAX_COLUMNS,
        Math.max(MIN_COLUMNS, Math.round(spanX / restY) + 1),
      );
      const rod = spanX / (columns - 1);
      restX = rod / GATHER;
      // A quarter-period sine of pleats keeps every link at its rest length.
      const depth = Math.sqrt(restX * restX - rod * rod);
      const left = (visible.left + visible.right - spanX) / 2;
      const top = visible.top + (visible.bottom - visible.top) * TOP_SHARE;
      for (let row = 0; row < ROWS; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const i = row * columns + column;
          x[i] = previousX[i] = left + column * rod;
          y[i] = previousY[i] = top + row * restY;
          z[i] = previousZ[i] = depth * Math.sin((column * Math.PI) / 2);
        }
      }
      grabbed = -1;
      calm = 0;
      for (let i = 0; i < SETTLE_STEPS && !step(); i += 1);
      rest();
    };

    const pinned = (i: number) => i < columns || i === grabbed;

    const link = (a: number, b: number, length: number) => {
      const dx = x[b] - x[a];
      const dy = y[b] - y[a];
      const dz = z[b] - z[a];
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || length;
      const fixedA = pinned(a);
      const fixedB = pinned(b);
      if (fixedA && fixedB) return;
      const share = (distance - length) / distance / (fixedA || fixedB ? 1 : 2);
      if (!fixedA) {
        x[a] += dx * share;
        y[a] += dy * share;
        z[a] += dz * share;
      }
      if (!fixedB) {
        x[b] -= dx * share;
        y[b] -= dy * share;
        z[b] -= dz * share;
      }
    };

    /** Advances the cloth one step, and says whether it has come to rest. */
    const step = () => {
      const total = columns * ROWS;
      const gravity = GRAVITY * restY;
      for (let i = columns; i < total; i += 1) {
        if (i === grabbed) continue;
        const vx = (x[i] - previousX[i]) * DAMPING;
        const vy = (y[i] - previousY[i]) * DAMPING;
        const vz = (z[i] - previousZ[i]) * DAMPING;
        previousX[i] = x[i];
        previousY[i] = y[i];
        previousZ[i] = z[i];
        x[i] += vx;
        y[i] += vy + gravity;
        z[i] += vz;
      }
      if (grabbed >= 0) {
        previousX[grabbed] = x[grabbed];
        previousY[grabbed] = y[grabbed];
        previousZ[grabbed] = z[grabbed];
        x[grabbed] = pointer.x + grabOffset.x;
        y[grabbed] = pointer.y + grabOffset.y;
      }
      for (let pass = 0; pass < ITERATIONS; pass += 1) {
        for (let row = 0; row < ROWS; row += 1) {
          for (let column = 0; column < columns; column += 1) {
            const i = row * columns + column;
            if (column + 1 < columns) link(i, i + 1, restX);
            if (row + 1 < ROWS) link(i, i + columns, restY);
          }
        }
      }
      let fastest = 0;
      for (let i = columns; i < total; i += 1) {
        fastest = Math.max(
          fastest,
          Math.abs(x[i] - previousX[i]),
          Math.abs(y[i] - previousY[i]),
          Math.abs(z[i] - previousZ[i]),
        );
      }
      calm = fastest < STILL * restY ? calm + 1 : 0;
      return calm >= CALM_STEPS;
    };

    const rest = () => {
      previousX.set(x);
      previousY.set(y);
      previousZ.set(z);
    };

    const brush = (dx: number, dy: number) => {
      const radius = BRUSH_RADIUS * restY;
      const reach = Math.hypot(dx, dy);
      // A jump, like the pointer coming back from off the canvas, is not a sweep.
      if (reach === 0 || reach > radius) return false;
      let touched = false;
      for (let i = columns; i < columns * ROWS; i += 1) {
        const distance = Math.hypot(x[i] - pointer.x, y[i] - pointer.y);
        if (distance >= radius) continue;
        const push = BRUSH * (1 - distance / radius);
        previousX[i] -= dx * push;
        previousY[i] -= dy * push;
        // The pointer brushes from in front, so the cloth gives way behind.
        previousZ[i] += reach * push;
        touched = true;
      }
      return touched;
    };

    const nearest = (at: Point) => {
      let best = -1;
      let gap = GRAB_REACH * restY;
      for (let i = columns; i < columns * ROWS; i += 1) {
        const distance = Math.hypot(x[i] - at.x, y[i] - at.y);
        if (distance < gap) {
          gap = distance;
          best = i;
        }
      }
      return best;
    };

    const light = (i: number, column: number, row: number) => {
      const left = column > 0 ? i - 1 : i;
      const right = column + 1 < columns ? i + 1 : i;
      const up = row > 0 ? i - columns : i;
      const down = row + 1 < ROWS ? i + columns : i;
      const ax = x[right] - x[left];
      const ay = y[right] - y[left];
      const az = z[right] - z[left];
      const bx = x[down] - x[up];
      const by = y[down] - y[up];
      const bz = z[down] - z[up];
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const facing =
        Math.abs(nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z) / length;
      return AMBIENT + (1 - AMBIENT) * facing;
    };

    const triangle = (a: number, b: number, c: number) => {
      const area =
        (x[b] - x[a]) * (y[c] - y[a]) - (y[b] - y[a]) * (x[c] - x[a]);
      if (area === 0) return;
      const left = Math.max(0, Math.floor(Math.min(x[a], x[b], x[c])));
      const right = Math.min(width - 1, Math.ceil(Math.max(x[a], x[b], x[c])));
      const top = Math.max(0, Math.floor(Math.min(y[a], y[b], y[c])));
      const bottom = Math.min(
        height - 1,
        Math.ceil(Math.max(y[a], y[b], y[c])),
      );
      for (let row = top; row <= bottom; row += 1) {
        const py = row + 0.5;
        for (let column = left; column <= right; column += 1) {
          const px = column + 0.5;
          const wa =
            ((x[b] - px) * (y[c] - py) - (y[b] - py) * (x[c] - px)) / area;
          const wb =
            ((x[c] - px) * (y[a] - py) - (y[c] - py) * (x[a] - px)) / area;
          const wc = 1 - wa - wb;
          if (wa < 0 || wb < 0 || wc < 0) continue;
          const level = wa * shade[a] + wb * shade[b] + wc * shade[c];
          pixels[(row * width + column) * 4 + 3] =
            (Math.round(level * SHADES) * 255) / SHADES;
        }
      }
    };

    const paint = () => {
      for (let row = 0; row < ROWS; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          shade[row * columns + column] = light(
            row * columns + column,
            column,
            row,
          );
        }
      }
      for (let i = 3; i < pixels.length; i += 4) pixels[i] = 0;
      for (let row = 0; row + 1 < ROWS; row += 1) {
        for (let column = 0; column + 1 < columns; column += 1) {
          const i = row * columns + column;
          triangle(i, i + 1, i + columns);
          triangle(i + 1, i + columns + 1, i + columns);
        }
      }
      context.putImageData(image, 0, 0);
    };

    const advance = () => {
      still = step();
    };

    const draw = (now: number) => {
      pace.advance(now, advance);
      paint();
      if (still) {
        rest();
        pace.restart();
        return false;
      }
      return true;
    };

    const loop = frameLoop(draw);

    const wake = () => {
      still = false;
      calm = 0;
      loop.wake();
    };

    const onMove = (event: PointerEvent) => {
      const point = pointOn(canvas, event);
      const dx = point.x - pointer.x;
      const dy = point.y - pointer.y;
      const was = hovering;
      pointer.x = point.x;
      pointer.y = point.y;
      hovering = true;
      if (grabbed >= 0 || (was && brush(dx, dy))) wake();
    };

    const onDown = (event: PointerEvent) => {
      Object.assign(pointer, pointOn(canvas, event));
      hovering = true;
      grabbed = nearest(pointer);
      if (grabbed < 0) return;
      grabOffset.x = x[grabbed] - pointer.x;
      grabOffset.y = y[grabbed] - pointer.y;
      wake();
    };

    const onLift = (event: PointerEvent) => {
      if (event.pointerType === "touch") hovering = false;
      if (grabbed < 0) return;
      grabbed = -1;
      wake();
    };

    const onLeave = () => {
      hovering = false;
    };

    const onResize = () => {
      hang();
      paint();
    };

    hang();
    const listening = new AbortController();
    const { signal } = listening;
    canvas.addEventListener("pointermove", onMove, { signal });
    canvas.addEventListener("pointerdown", onDown, { signal });
    canvas.addEventListener("pointerup", onLift, { signal });
    canvas.addEventListener("pointercancel", onLift, { signal });
    canvas.addEventListener("pointerleave", onLeave, { signal });
    window.addEventListener("resize", onResize, { signal });
    loop.wake();

    return () => {
      listening.abort();
      loop.stop();
    };
  },
};
