import type { BackdropDisplay } from "../pixel-backdrop/display";

/** A display of every kind: plain in each scheme, and panels between them setting every look field. */
export const DISPLAYS = {
  light: { base: "#f4f4f2", ink: "#8a8a99" },
  dark: { base: "#141414", ink: "#6e6e7a" },
  panel: {
    base: "#889d58",
    ink: "#263c2b",
    look: {
      grid: "#0000000a",
      levels: 4,
      gap: 2,
      ghostRise: 45,
      ghostFall: 30,
      shadow: { opacity: 25, x: 4, y: 4 },
    },
  },
  backlit: {
    base: "#f89b03",
    ink: "#3c070d",
    look: {
      vignette: { clear: 33, edge: "#e6d3d3" },
      levels: 4,
      dither: true,
      gap: 1,
      ghostRise: 86,
      ghostFall: 76,
    },
  },
  graded: {
    base: "#04070a",
    ink: "#f2fdff",
    look: {
      stops: ["#0a3346", "#11a6d8", "#7fe6ff"],
      levels: 5,
      gap: 2,
      ghostRise: 40,
      ghostFall: 65,
    },
  },
} satisfies Record<string, BackdropDisplay>;
