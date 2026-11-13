import { HORIZON, landscape, PEAKS, type Terrain } from "../../lib/landscape";
import { TUNED_GRID, visibleCells, type Toy } from "./toy";

/**
 * A still range, as the link previews draw it, on the bottom of the visible
 * cells. Each start picks a new range, which a resize redraws unchanged.
 */
function still(id: string, label: string, terrain: Terrain): Toy {
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
        const { cells } = landscape(
          seed,
          terrain,
          columns,
          rows,
          canvas.width / TUNED_GRID,
        );
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

export const peaks = still("peaks", "Peaks", PEAKS);
export const horizon = still("horizon", "Horizon", HORIZON);
