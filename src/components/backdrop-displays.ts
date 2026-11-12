/**
 * The screen a display theme gives the backdrop, as the canvas knobs that
 * draw it. Colours are hex only: any other form makes the palette pass parse
 * it through a helper canvas.
 */
export type DisplayLook = {
  /** What shows through the gaps and past the grid's edge. */
  screen: string;
  /**
   * Paints the gaps instead of the screen. A translucent one lets each
   * pixel show through, so dark neighbours merge and the grid stays faint.
   */
  grid?: string;
  /** The off pixels, which `data-palette-base` takes. */
  base: string;
  /** The lit pixels, which `data-palette-ink` takes. */
  ink: string;
  levels: number;
  /** Space between cells, in whole CSS pixels. */
  gap: number;
  shape: "square" | "circle";
  /** Ghost, 0–100, for pixels getting brighter and darker. */
  ghostRise: number;
  ghostFall: number;
  noise: number;
  /** Opacity 0–100 and offset in whole CSS pixels. */
  shadow: { opacity: number; x: number; y: number };
};

export type Display = {
  id: string;
  label: string;
  look?: DisplayLook;
};

/**
 * Every display theme, in menu order; the first is the site's own look. The
 * screens' numbers are tunable. A lit pixel is the ink, so its luma rises as
 * it appears: a panel brings its ink up faster than it clears it.
 */
export const DISPLAYS: Display[] = [
  { id: "site", label: "Site" },
  {
    id: "pocket-lcd",
    label: "Pocket LCD",
    look: {
      screen: "#889d58",
      grid: "#0000000a",
      base: "#889d58",
      ink: "#1f3326",
      levels: 4,
      gap: 2,
      shape: "square",
      ghostRise: 30,
      ghostFall: 45,
      noise: 0,
      shadow: { opacity: 55, x: 3, y: 3 },
    },
  },
  {
    id: "amber-lcd",
    label: "Amber LCD",
    look: {
      screen: "#e8a33a",
      base: "#e8a33a",
      ink: "#3a2410",
      levels: 2,
      gap: 2,
      shape: "square",
      ghostRise: 50,
      ghostFall: 65,
      noise: 0,
      shadow: { opacity: 30, x: 2, y: 2 },
    },
  },
];

export const DISPLAY_KEY = "backdrop-display";

const IDS = DISPLAYS.map((display) => display.id);

export function storedDisplay() {
  try {
    const id = localStorage.getItem(DISPLAY_KEY);
    return id !== null && IDS.includes(id) ? id : undefined;
  } catch {
    return undefined;
  }
}
