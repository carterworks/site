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
  /** A backlight's fall-off, as an image multiplied over the whole screen. */
  vignette?: string;
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
      screen: "#889d58",
      grid: "#0000000a",
      base: "#889d58",
      ink: "#263c2b",
      levels: 4,
      gap: 2,
      shape: "square",
      ghostRise: 45,
      ghostFall: 30,
      noise: 0,
      shadow: { opacity: 25, x: 4, y: 4 },
    },
  },
  {
    id: "amber-lcd",
    label: "Amber LCD",
    look: {
      screen: "#f89b03",
      vignette: "radial-gradient(farthest-corner, #fff 33%, #e6d3d3)",
      base: "#f89b03",
      ink: "#3c070d",
      levels: 2,
      gap: 1,
      shape: "square",
      ghostRise: 86,
      ghostFall: 76,
      noise: 0,
      shadow: { opacity: 0, x: 0, y: 0 },
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
