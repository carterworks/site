import type { BackdropInput, CellRect, Mode } from "./mode";

/**
 * The gallery tile is 48 cells across at about 8 px a cell with 6 blobs. On the
 * site a cell is the viewport width over `columns`, so sizes and speeds, which
 * the prototype tuned in cells, scale by the ratio of cell sizes at this width.
 */
const PROTOTYPE_CELL_PX = 8;
const REFERENCE_WIDTH_PX = 1440;
const PROTOTYPE_BLOBS = 6;
const PROTOTYPE_AREA = 48 * 48;
/** The lamp is left on this long after the last input, then cools. */
const COOL_MS = 12_000;
const COOLING_DRAG = 0.96;
const STOPPED_SPEED = 0.002;

type Blob = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  heat: number;
};

/** Where a blob's influence is capped; the part above it is summed per cell. */
const TAIL = 0.02;
/** Cells between samples of the capped remainder. */
const FAR_STRIDE = 4;

export type BlobScratch = { near: Float64Array; far: Float64Array };

type Press = NonNullable<BackdropInput["press"]>;
type Grab = { blob: Blob; dx: number; dy: number; press: Press };

/**
 * A lava lamp: blobs warm near the bottom, rise, cool near the top and sink.
 * Press a blob to hold and drag it, let go to fling it; tapping empty glass
 * shoves the wax away and hovering nudges it. Left alone the lamp cools to a
 * stop, so an untouched tab costs nothing, and any input warms it again.
 */
export const wax: Mode = {
  id: "wax",
  label: "Lamp Wax",
  look: { ghost: 75, noise: 8 },
  holds: true,
  create({ columns, rows, random }) {
    const scale = (columns * PROTOTYPE_CELL_PX) / REFERENCE_WIDTH_PX;
    const reach = 18 * scale;
    const blobs: Blob[] = [];
    const scratch: BlobScratch = {
      near: new Float64Array(columns * rows),
      far: new Float64Array(columns * rows),
    };
    let visible: CellRect = { left: 0, top: 0, right: 0, bottom: 0 };
    let grab: Grab | undefined;
    let seenPress: Press | undefined;
    let startedAt = 0;
    let settled = false;

    const spawn = () => {
      const width = visible.right - visible.left;
      const height = visible.bottom - visible.top;
      const count = Math.max(
        2,
        Math.round(
          (PROTOTYPE_BLOBS * width * height) / scale ** 2 / PROTOTYPE_AREA,
        ),
      );
      for (let k = 0; k < count; k += 1) {
        const share = k / (count - 1);
        blobs.push({
          x: visible.left + width * (0.1 + 0.8 * random()),
          y: visible.top + height * (0.125 + 0.75 * share),
          vx: 0,
          vy: 0,
          r: (3 + random() * 2.2) * scale,
          heat: share > 0.5 ? 0.8 : 0.2,
        });
      }
    };

    const shove = (x: number, y: number, force: number) => {
      for (const blob of blobs) {
        const dx = blob.x - x;
        const dy = blob.y - y;
        const distance = Math.hypot(dx, dy) || 1;
        if (distance < reach) {
          const push = (force * (1 - distance / reach)) / distance;
          blob.vx += dx * push;
          blob.vy += dy * push;
        }
      }
    };

    const grabNearest = (x: number, y: number, press: Press) => {
      let nearest: Blob | undefined;
      let gap = 3 * scale;
      for (const blob of blobs) {
        const away = Math.hypot(blob.x - x, blob.y - y) - blob.r;
        if (away < gap) [gap, nearest] = [away, blob];
      }
      if (nearest === undefined) return undefined;
      return { blob: nearest, dx: nearest.x - x, dy: nearest.y - y, press };
    };

    return {
      step({ pointer, press, lastInputAt, visible: seen }, now) {
        visible = seen;
        if (blobs.length === 0) {
          startedAt = now;
          spawn();
        }
        if (grab !== undefined && (press !== grab.press || !press.held)) {
          grab = undefined;
        }
        if (press !== undefined && press !== seenPress) {
          seenPress = press;
          if (press.held) grab = grabNearest(press.x, press.y, press);
          if (grab === undefined) shove(press.x, press.y, 0.9 * scale);
        }

        const awake =
          grab !== undefined ||
          now - Math.max(lastInputAt, startedAt) < COOL_MS;
        const height = visible.bottom - visible.top;

        if (grab !== undefined) {
          const target = pointer ?? grab.press;
          const { blob } = grab;
          blob.vx = (blob.vx + (target.x + grab.dx - blob.x) * 0.14) * 0.72;
          blob.vy = (blob.vy + (target.y + grab.dy - blob.y) * 0.14) * 0.72;
          blob.heat = 0.5;
        }

        let fastest = 0;
        for (const blob of blobs) {
          if (blob !== grab?.blob) {
            if (!awake) {
              blob.vx *= COOLING_DRAG;
              blob.vy *= COOLING_DRAG;
            } else {
              if (pointer !== undefined) {
                const dx = blob.x - pointer.x;
                const dy = blob.y - pointer.y;
                const distance = Math.hypot(dx, dy) || 1;
                if (distance < blob.r + 4 * scale) {
                  blob.vx += (dx / distance) * 0.02 * scale;
                  blob.vy += (dy / distance) * 0.02 * scale;
                }
              }
              if (blob.y > visible.top + height * 0.8) {
                blob.heat = Math.min(1, blob.heat + 0.004);
              } else if (blob.y < visible.top + height * 0.2) {
                blob.heat = Math.max(0, blob.heat - 0.004);
              }
              blob.vy -= (blob.heat - 0.5) * 0.003 * scale;
              blob.vx += (random() - 0.5) * 0.004 * scale;
              blob.vx *= 0.985;
              blob.vy *= 0.985;
              if (Math.hypot(blob.vx, blob.vy) > 0.16 * scale) {
                blob.vx *= 0.95;
                blob.vy *= 0.95;
              }
            }
          }
          blob.x += blob.vx;
          blob.y += blob.vy;

          const margin = blob.r * 0.6;
          const left = visible.left + margin;
          const right = visible.right - margin;
          const top = visible.top + margin;
          const bottom = visible.bottom - margin;
          if (blob.x < left)
            [blob.x, blob.vx] = [left, Math.abs(blob.vx) * 0.4];
          if (blob.x > right)
            [blob.x, blob.vx] = [right, -Math.abs(blob.vx) * 0.4];
          if (blob.y < top) [blob.y, blob.vy] = [top, Math.abs(blob.vy) * 0.4];
          if (blob.y > bottom)
            [blob.y, blob.vy] = [bottom, -Math.abs(blob.vy) * 0.4];
          fastest = Math.max(fastest, Math.abs(blob.vx), Math.abs(blob.vy));
        }

        settled = !awake && fastest < STOPPED_SPEED;
        if (settled) {
          for (const blob of blobs) [blob.vx, blob.vy] = [0, 0];
        }
      },

      // Per-cell work stays plain arithmetic, clear of the work budget's Math calls.
      render(field) {
        renderBlobs(blobs, visible, columns, scratch, field);
      },

      pace: () => (settled ? "still" : "active"),
    };
  },
};

/**
 * Bands the summed influence of the blobs over the visible cells. A blob's
 * `r² / (d² + 0.5)` falls off slowly, so it is split at `TAIL`: the part above
 * it is added exactly within the box where it exists, and the capped remainder,
 * which is smooth, is sampled on a coarse lattice and interpolated. The cost
 * follows the blobs' size, not their count times the whole grid.
 */
export function renderBlobs(
  blobs: readonly Pick<Blob, "x" | "y" | "r">[],
  visible: CellRect,
  columns: number,
  { near, far }: BlobScratch,
  field: Float32Array,
) {
  const left = Math.max(0, Math.floor(visible.left));
  const right = Math.min(columns, Math.ceil(visible.right));
  const top = Math.max(0, Math.floor(visible.top));
  const bottom = Math.ceil(visible.bottom);
  const lw = Math.ceil((right - left) / FAR_STRIDE) + 2;
  const lh = Math.ceil((bottom - top) / FAR_STRIDE) + 2;
  for (let y = top; y < bottom; y += 1) {
    near.fill(0, y * columns + left, y * columns + right);
  }
  far.fill(0, 0, lw * lh);

  for (const blob of blobs) {
    const strength = blob.r * blob.r;
    const radius = blob.r * Math.sqrt(1 / TAIL);
    const x0 = Math.max(left, Math.floor(blob.x - radius));
    const x1 = Math.min(right, Math.ceil(blob.x + radius));
    const y0 = Math.max(top, Math.floor(blob.y - radius));
    const y1 = Math.min(bottom, Math.ceil(blob.y + radius));
    for (let y = y0; y < y1; y += 1) {
      const dy = y + 0.5 - blob.y;
      for (let x = x0; x < x1; x += 1) {
        const dx = x + 0.5 - blob.x;
        const reach = strength / (dx * dx + dy * dy + 0.5);
        if (reach > TAIL) near[y * columns + x] += reach - TAIL;
      }
    }
    for (let j = 0; j < lh; j += 1) {
      const dy = top + j * FAR_STRIDE + 0.5 - blob.y;
      for (let i = 0; i < lw; i += 1) {
        const dx = left + i * FAR_STRIDE + 0.5 - blob.x;
        const reach = strength / (dx * dx + dy * dy + 0.5);
        far[j * lw + i] += reach > TAIL ? TAIL : reach;
      }
    }
  }

  for (let y = top; y < bottom; y += 1) {
    const v = (y - top) / FAR_STRIDE;
    const j = v | 0;
    const fy = v - j;
    for (let x = left; x < right; x += 1) {
      const u = (x - left) / FAR_STRIDE;
      const i = u | 0;
      const fx = u - i;
      const at = j * lw + i;
      const sum =
        near[y * columns + x] +
        (far[at] * (1 - fx) + far[at + 1] * fx) * (1 - fy) +
        (far[at + lw] * (1 - fx) + far[at + lw + 1] * fx) * fy;
      field[y * columns + x] =
        sum >= 1 ? 1 : sum > 0.72 ? 0.55 : sum > 0.5 ? 0.22 : 0;
    }
  }
}
