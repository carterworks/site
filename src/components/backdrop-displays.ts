import { storedChoice } from "../lib/cycle-setting";

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
  vignette?: string;
  base: string;
  ink: string;
  levels: number;
  gap: number;
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
 * darkens solid ink to ink·(1 − o + o·ink/base). The shadow is kept to the
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
      ghostRise: 45,
      ghostFall: 30,
      shadow: { opacity: 25, x: 4, y: 4 },
    },
  },
  {
    id: "amber-lcd",
    label: "Amber LCD",
    look: {
      vignette: "radial-gradient(farthest-corner, #fff 33%, #e6d3d3)",
      base: "#f89b03",
      ink: "#3c070d",
      levels: 2,
      gap: 1,
      ghostRise: 86,
      ghostFall: 76,
    },
  },
];

export const DISPLAY_KEY = "backdrop-display";

const IDS = DISPLAYS.map((display) => display.id);

export const storedDisplay = () => storedChoice(DISPLAY_KEY, IDS);
