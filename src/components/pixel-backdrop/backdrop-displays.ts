/**
 * A physical panel's effects: quantised levels, a grid, a ghost that rises and
 * falls at its own speeds. Without one, a display is a plain palette with the
 * drifting noise. Colours are hex only: any other form makes the palette pass
 * parse it through a helper canvas.
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
  /** Colours spaced evenly between the base and the ink, which the scale runs through. */
  stops?: string[];
  levels: number;
  /** Mixes neighbouring levels in an ordered pattern, so shades between them still show. */
  dither?: boolean;
  gap: number;
  ghostRise: number;
  ghostFall: number;
  shadow?: { opacity: number; x: number; y: number };
};

/** A theme for the site: the backdrop's screen and the page over it. */
export type Display = {
  id: string;
  label: string;
  /** The only scheme it shows in, the one whose page panels suit its screen. */
  scheme: "light" | "dark";
  /** The canvas's unlit pixels, and the screen behind it on a panel. */
  base: string;
  /** The canvas's fully lit pixels, across every toy and the noise. */
  ink: string;
  /** The page's `--color-bg`, `--color-text` and `--color-accent`. */
  page: { bg: string; text: string; accent: string };
  look?: DisplayLook;
};

/**
 * Every display, in menu order, light then dark; each scheme's first is the
 * site's own look in it, and its default. Adding one here is all a new theme
 * needs: the menus, the page's colours and the backdrop all read this list.
 * The screens' numbers are tuned against reference photos. The ghost runs after
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
  {
    id: "site-light",
    label: "Site",
    scheme: "light",
    base: "#f4f4f2",
    ink: "#8a8a99",
    page: { bg: "#f8f8f8", text: "#121212", accent: "#8a8a99" },
  },
  {
    id: "pocket-lcd",
    label: "Pocket LCD",
    scheme: "light",
    base: "#889d58",
    ink: "#263c2b",
    page: { bg: "#e8edd6", text: "#1f3326", accent: "#263c2b" },
    look: {
      grid: "#0000000a",
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
    base: "#f89b03",
    ink: "#3c070d",
    page: { bg: "#fff4e3", text: "#3c070d", accent: "#3c070d" },
    look: {
      vignette: { clear: 33, edge: "#e6d3d3" },
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
    base: "#cdd8ee",
    ink: "#000000",
    page: { bg: "#f4f7fc", text: "#151a24", accent: "#d93a00" },
    look: {
      stops: ["#2bd96b", "#e3f01c", "#ff4a0a"],
      levels: 5,
      gap: 2,
      ghostRise: 40,
      ghostFall: 40,
    },
  },
  {
    id: "site-dark",
    label: "Site",
    scheme: "dark",
    base: "#141414",
    ink: "#6e6e7a",
    page: { bg: "#121212", text: "#f8f8f8", accent: "#6e6e7a" },
  },
  // On a dark screen clearing darkens, so the fall is the trail.
  {
    id: "grid",
    label: "Grid",
    scheme: "dark",
    base: "#04070a",
    ink: "#f2fdff",
    page: { bg: "#061018", text: "#e3f9ff", accent: "#11a6d8" },
    look: {
      stops: ["#0a3346", "#11a6d8", "#7fe6ff"],
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

/**
 * The scheme on show: the theme toggle's override, set on `<html>`'s inline
 * colorScheme, else the OS's.
 */
export function shownScheme(root: HTMLElement): Scheme {
  const override = root.style.colorScheme;
  if (override === "light" || override === "dark") return override;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

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

/**
 * The page's colours for every display, as `--display-<scheme>-*` custom
 * properties: each scheme's default on `:root`, the rest under the attribute
 * that shows them. global.css picks the shown scheme's with `light-dark()`.
 */
export function displayColours() {
  return DISPLAYS.map((display) => {
    const { id, scheme, page } = display;
    const selector =
      display === BY_SCHEME[scheme][0]
        ? ":root"
        : `:root[${displayAttribute(scheme)}="${id}"]`;
    const colours = Object.entries(page)
      .map(([name, colour]) => `--display-${scheme}-${name}: ${colour};`)
      .join(" ");
    return `${selector} { ${colours} }`;
  }).join("\n");
}
