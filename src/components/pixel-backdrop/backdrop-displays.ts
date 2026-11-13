import { storedChoice } from "../../lib/cycle-setting";

/**
 * The screen a display gives the backdrop, as the canvas knobs that
 * draw it. Colours are hex only: any other form makes the palette pass parse
 * it through a helper canvas.
 */
export type DisplayLook = {
  /**
   * Paints the gaps instead of the screen. A translucent one lets each
   * pixel show through, so dark neighbours merge and the grid stays faint.
   */
  grid?: string;
  /**
   * A backlight fading toward the corners: the screen multiplied by white out
   * to `clear` percent of the way to the farthest corner, then by a colour
   * falling to `edge` there.
   */
  vignette?: { clear: number; edge: string };
  base: string;
  /** Colours spaced evenly between the base and the ink, which the scale runs through. */
  stops?: string[];
  ink: string;
  levels: number;
  gap: number;
  /** The cells' form; without one, the shape knob decides. */
  shape?:
    | "square"
    | "circle"
    | "ring"
    | "diamond"
    | "hex"
    | "triangle"
    | "dash"
    | "slash"
    | "cross";
  ghostRise: number;
  ghostFall: number;
  shadow?: { opacity: number; x: number; y: number };
};

export type Display = {
  id: string;
  label: string;
  look?: DisplayLook;
};

/**
 * Every display, in menu order; the first is the site's own look. The
 * screens' numbers are tuned against reference photos. The ghost runs after
 * the palette, so ink appearing darkens a pixel and clearing brightens it: an
 * STN panel switches on faster than it relaxes, so it rises slower than it
 * falls.
 *
 * Pocket's ink is lighter than the photo's #1f3326 because its own shadow
 * darkens solid ink to ink·(1 − o + o·ink/base). The shadow is paint exact
 * over the base, so on ink that holds in red and leaves green and blue 2–3/255
 * lighter, #1f3528 for #1f3326. The shadow is kept to the
 * reference render's ~16% rather than a reflective panel's full double pass,
 * which darkens the backing beside every shape by 45%.
 */
export const DISPLAYS: Display[] = [
  { id: "site", label: "Site" },
  {
    id: "pocket-lcd",
    label: "Pocket LCD",
    look: {
      grid: "#0000000a",
      base: "#889d58",
      ink: "#263c2b",
      levels: 4,
      gap: 2,
      shape: "square",
      ghostRise: 45,
      ghostFall: 30,
      shadow: { opacity: 25, x: 4, y: 4 },
    },
  },
  {
    id: "amber-lcd",
    label: "Amber LCD",
    look: {
      vignette: { clear: 33, edge: "#e6d3d3" },
      base: "#f89b03",
      ink: "#3c070d",
      levels: 2,
      gap: 1,
      shape: "square",
      ghostRise: 86,
      ghostFall: 76,
    },
  },
  {
    id: "thermal",
    label: "Thermal",
    look: {
      base: "#cdd8ee",
      stops: ["#2bd96b", "#e3f01c", "#ff4a0a"],
      ink: "#000000",
      levels: 5,
      gap: 2,
      shape: "square",
      ghostRise: 40,
      ghostFall: 40,
    },
  },
  // On a dark screen clearing darkens, so the fall is the trail.
  {
    id: "tet",
    label: "Tet",
    look: {
      base: "#0b1218",
      stops: ["#12384a", "#2a8fb0", "#9fe9ff"],
      ink: "#ff6a3d",
      levels: 5,
      gap: 2,
      ghostRise: 40,
      ghostFall: 55,
    },
  },
  {
    id: "grid",
    label: "Grid",
    look: {
      base: "#04070a",
      stops: ["#0a3346", "#11a6d8", "#7fe6ff"],
      ink: "#f2fdff",
      levels: 5,
      gap: 2,
      ghostRise: 40,
      ghostFall: 65,
    },
  },
];

export const DISPLAY_KEY = "backdrop-display";

const IDS = DISPLAYS.map((display) => display.id);

export const storedDisplay = () => storedChoice(DISPLAY_KEY, IDS);
