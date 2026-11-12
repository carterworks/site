import { visibleCells, type Toy } from "./toy";

/**
 * A picture the visitor chose, for the playground. The caller owns the
 * bitmap, so stopping never closes it: the same toy can start again.
 */
export function imageToy(source: ImageBitmap): Toy {
  return {
    id: "image",
    label: "Image",
    start(canvas) {
      const context = canvas.getContext("2d");
      const draw = () => {
        if (context === null) return;
        const { left, top, right, bottom } = visibleCells(canvas);
        const scale = Math.min(
          (right - left) / source.width,
          (bottom - top) / source.height,
        );
        const width = Math.round(source.width * scale);
        const height = Math.round(source.height * scale);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingQuality = "high";
        context.drawImage(
          source,
          Math.round(left + (right - left - width) / 2),
          Math.round(top + (bottom - top - height) / 2),
          width,
          height,
        );
      };
      draw();
      window.addEventListener("resize", draw);
      return () => window.removeEventListener("resize", draw);
    },
  };
}
