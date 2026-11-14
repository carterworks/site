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
  /** Mixes neighbouring levels in an ordered pattern, so shades between them still show. */
  dither?: boolean;
  gap: number;
  ghostRise: number;
  ghostFall: number;
  shadow?: { opacity: number; x: number; y: number };
};

export type Display = {
  id: string;
  label: string;
  /** The only scheme it shows in, the one whose page panels suit its screen. */
  scheme: "light" | "dark";
  look?: DisplayLook;
  /**
   * The page's colours over this screen, as `--color-bg`, `--color-text` and
   * `--color-accent`; without, the scheme's own. Hex only, for the contrast test.
   */
  page?: { bg: string; text: string; accent: string };
};

/**
 * Every display, in menu order, light then dark; each scheme's first is the
 * site's own look in it, and its default. The
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
  { id: "site-light", label: "Site", scheme: "light" },
  {
    id: "pocket-lcd",
    label: "Pocket LCD",
    scheme: "light",
    page: { bg: "#e8edd6", text: "#1f3326", accent: "#263c2b" },
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
  // Two plain levels round every shade under half away, which blanked dim
  // toys like Planet and the mountains' shading; four dithered keep them.
  {
    id: "amber-lcd",
    label: "Amber LCD",
    scheme: "light",
    page: { bg: "#fff4e3", text: "#3c070d", accent: "#3c070d" },
    look: {
      vignette: { clear: 33, edge: "#e6d3d3" },
      base: "#f89b03",
      ink: "#3c070d",
      levels: 4,
      dither: true,
      gap: 1,
      ghostRise: 86,
      ghostFall: 76,
    },
  },
  {
    id: "thermal",
    label: "Thermal",
    scheme: "light",
    page: { bg: "#f4f7fc", text: "#151a24", accent: "#d93a00" },
    look: {
      base: "#cdd8ee",
      stops: ["#2bd96b", "#e3f01c", "#ff4a0a"],
      ink: "#000000",
      levels: 5,
      gap: 2,
      ghostRise: 40,
      ghostFall: 40,
    },
  },
  { id: "site-dark", label: "Site", scheme: "dark" },
  // On a dark screen clearing darkens, so the fall is the trail.
  {
    id: "grid",
    label: "Grid",
    scheme: "dark",
    page: { bg: "#061018", text: "#e3f9ff", accent: "#11a6d8" },
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

type Scheme = Display["scheme"];

/** Built once, as the backdrop looks a display up on every apply. */
const BY_SCHEME: Record<Scheme, readonly Display[]> = {
  light: DISPLAYS.filter((display) => display.scheme === "light"),
  dark: DISPLAYS.filter((display) => display.scheme === "dark"),
};

export const displaysFor = (scheme: Scheme) => BY_SCHEME[scheme];

/** Each scheme keeps its own choice, so a light screen never shows in dark. */
export const displayKey = (scheme: Scheme) => `backdrop-display-${scheme}`;

/**
 * Where the page holds each scheme's display: the head script sets it from
 * storage before first paint, so CSS and the backdrop read one source.
 */
export const displayAttribute = (scheme: Scheme) => `data-display-${scheme}`;

/** An id missing, unknown or from the other scheme shows the site's own look. */
export function shownDisplay(root: Element, scheme: Scheme) {
  const [site, ...screens] = BY_SCHEME[scheme];
  const id = root.getAttribute(displayAttribute(scheme));
  return screens.find((display) => display.id === id) ?? site;
}

export function showDisplay(root: Element, display: Display) {
  const name = displayAttribute(display.scheme);
  if (display === BY_SCHEME[display.scheme][0]) root.removeAttribute(name);
  else root.setAttribute(name, display.id);
}
