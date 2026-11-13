import {
  crags as cragsScene,
  type Grid,
  HORIZON,
  landscape,
  PEAKS,
} from "../../lib/landscape";
import { TUNED_GRID, visibleCells, type Toy } from "./toy";

type Scene = (
  seed: number,
  columns: number,
  rows: number,
  scale: number,
) => Grid;

/**
 * A still scene on the bottom of the visible cells. Each start picks a new
 * one, which a resize redraws unchanged.
 */
function still(id: string, label: string, scene: Scene): Toy {
  return {
    id,
    label,
    start(canvas) {
      const context = canvas.getContext("2d");
      const seed = Math.floor(Math.random() * 2 ** 32);
      const draw = () => {
        if (context === null) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        const visible = visibleCells(canvas);
        const left = Math.floor(visible.left);
        const top = Math.floor(visible.top);
        const columns = Math.ceil(visible.right) - left;
        const rows = Math.ceil(visible.bottom) - top;
        if (columns === 0 || rows === 0) return;
        const { cells } = scene(seed, columns, rows, canvas.width / TUNED_GRID);
        const image = context.createImageData(columns, rows);
        cells.forEach((value, i) => {
          image.data.fill(255, i * 4, i * 4 + 3);
          image.data[i * 4 + 3] = value * 255;
        });
        context.putImageData(image, left, top);
      };
      draw();
      const listening = new AbortController();
      window.addEventListener("resize", draw, { signal: listening.signal });
      return () => listening.abort();
    },
  };
}

/** The link previews' ranges. */
export const peaks = still("peaks", "Peaks", (seed, ...size) =>
  landscape(seed, PEAKS, ...size),
);
export const horizon = still("horizon", "Horizon", (seed, ...size) =>
  landscape(seed, HORIZON, ...size),
);
export const crags = still("crags", "Crags", cragsScene);
