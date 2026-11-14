import { expect, test, vi } from "vitest";
import {
  DISPLAYS,
  displayAttribute,
  displayColours,
  displaysFor,
  showDisplay,
  shownDisplay,
  shownScheme,
} from "./backdrop-displays";
import { MAX_GHOST } from "../emulated-canvas/limits";
import { hexRgb } from "../../lib/rgb";

const looks = DISPLAYS.filter(({ look }) => look);

test.each(["light", "dark"] as const)(
  "%s mode offers the site's own look first, then screens of its own",
  (scheme) => {
    const [site, ...screens] = displaysFor(scheme);
    expect(site).toMatchObject({ label: "Site", scheme });
    expect(site.look).toBeUndefined();
    expect(screens).not.toHaveLength(0);
    expect(screens.every(({ look }) => look)).toBe(true);
  },
);

test("every display belongs to exactly one scheme", () => {
  expect([...displaysFor("light"), ...displaysFor("dark")]).toHaveLength(
    DISPLAYS.length,
  );
});

test("ids are unique", () => {
  const ids = DISPLAYS.map(({ id }) => id);
  expect(new Set(ids).size).toBe(ids.length);
});

test.each(DISPLAYS)(
  "$id's colours are hex: the palette pass needs a helper canvas to parse any other form, and the contrast test this",
  ({ base, ink, page, look }) => {
    const colours = [base, ink, ...Object.values(page), ...(look?.stops ?? [])];
    if (look?.vignette) colours.push(look.vignette.edge);
    for (const colour of colours) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
  },
);

test.each(looks)(
  "$label's ghost stays below the cap, so the panel never freezes",
  ({ look }) => {
    for (const ghost of [look!.ghostRise, look!.ghostFall]) {
      expect(ghost).toBeGreaterThanOrEqual(0);
      expect(ghost).toBeLessThanOrEqual(MAX_GHOST * 100);
    }
  },
);

test.each(["light", "dark"] as const)(
  "with nothing on <html>, %s mode shows the site's own look",
  (scheme) => {
    const root = document.createElement("html");

    expect(shownDisplay(root, scheme)).toBe(displaysFor(scheme)[0]);
  },
);

test("each scheme shows its own display, and never one from the other scheme", () => {
  const root = document.createElement("html");
  const [, pocket] = displaysFor("light");
  const [, grid] = displaysFor("dark");

  showDisplay(root, pocket);
  showDisplay(root, grid);

  expect(shownDisplay(root, "light")).toBe(pocket);
  expect(shownDisplay(root, "dark")).toBe(grid);
  root.setAttribute(displayAttribute("light"), grid.id);
  expect(shownDisplay(root, "light")).toBe(displaysFor("light")[0]);
});

test("showing a scheme's own site look clears its attribute", () => {
  const root = document.createElement("html");
  const [site, pocket] = displaysFor("light");

  showDisplay(root, pocket);
  showDisplay(root, site);

  expect(root.hasAttribute(displayAttribute("light"))).toBe(false);
});

/** WCAG 2's relative luminance of a hex colour. */
function luminance(hex: string) {
  const [r, g, b] = hexRgb(hex)!.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

/** The browser's own link colours, which the site leaves as they are. */
const LINK = { light: "#0000ee", dark: "#9e9eff" };

test.each(DISPLAYS)(
  "$id's panels keep text and links at WCAG AA, and its accent at 3:1",
  ({ page, scheme }) => {
    expect(contrast(page.text, page.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(LINK[scheme], page.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(page.accent, page.bg)).toBeGreaterThanOrEqual(3);
  },
);

test.each(["light", "dark"] as const)(
  "the page takes the %s display's colours, and the site's own with none shown",
  (scheme) => {
    const style = document.createElement("style");
    style.textContent = displayColours();
    document.head.append(style);
    const root = document.documentElement;
    const shown = () =>
      Object.fromEntries(
        ["bg", "text", "accent"].map((name) => [
          name,
          getComputedStyle(root)
            .getPropertyValue(`--display-${scheme}-${name}`)
            .trim(),
        ]),
      );

    try {
      for (const display of displaysFor(scheme)) {
        showDisplay(root, display);
        expect(shown()).toEqual(display.page);
      }
    } finally {
      style.remove();
      root.removeAttribute(displayAttribute(scheme));
    }
  },
);

test.each([
  ["light", "dark", "light"],
  ["dark", "light", "dark"],
  ["", "dark", "dark"],
  ["normal", "dark", "dark"],
] as const)(
  "with %j on <html> and a %s OS, %s is shown: the toggle's override wins, anything else follows the OS",
  (override, os, shown) => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("dark") === (os === "dark"),
    }));
    const root = document.createElement("html");
    root.style.colorScheme = override;

    try {
      expect(shownScheme(root)).toBe(shown);
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
