import { isDeepStrictEqual } from "node:util";
import { expect, test } from "vitest";
import { DISPLAYS, type Display, type DisplayLook } from "./backdrop-displays";
import type { Toy } from "../backdrop-toys/toy";
import { EmulatedCanvas } from "../emulated-canvas/element";
import { SHAPES as CANVAS_SHAPES } from "../emulated-canvas/presenter";
import { KNOBS, type BackdropKnobs } from "./knobs";
import { resolveLook, type LookInput, type ResolvedLook } from "./look";

/** Each value apart from every source that can stand in for it, so a case shows which one won. */
const DEFAULTS: BackdropKnobs = {
  enabled: true,
  autoFit: true,
  scale: 7,
  gap: 3,
  shape: "circle",
  ghost: 70,
  noise: 18,
  noiseScale: 15,
  noiseSpeed: 5,
  lightBase: "#f4f4f2",
  lightInk: "#8a8a99",
  darkBase: "#141414",
  darkInk: "#6e6e7a",
};

const toy = (id: string, look?: Toy["look"]): Toy => ({
  id,
  label: id,
  look,
  start: () => () => {},
});
const plain = toy("plain");
const tuned = toy("tuned", { ghost: 55, noise: 12 });

const displayOf = (id: string) =>
  DISPLAYS.find((display) => display.id === id)!;
const site = displayOf("site");
const pocket = displayOf("pocket-lcd");
const amber = displayOf("amber-lcd");
const screen = pocket.look!;

const FRESH: LookInput = {
  defaults: DEFAULTS,
  tweaks: {},
  toy: plain,
  display: site,
  scheme: "light",
  columns: 160,
};

const resolve = (input: Partial<LookInput> = {}) =>
  resolveLook({ ...FRESH, ...input });

type Rung = [source: string, input: Partial<LookInput>, shown: unknown];

/**
 * Every knob's sources, lowest first. Each rung's input holds every source
 * below it too, so the value it shows proves it outranks them. A knob with
 * only a default and a tweak is shown on a tuned toy and a display, which
 * must not move it.
 */
const ladders: Record<
  keyof BackdropKnobs,
  { read: (look: ResolvedLook) => unknown; rungs: Rung[] }
> = {
  enabled: {
    read: (look) => look.hostFlags["data-disabled"],
    rungs: [
      ["default", { toy: tuned, display: pocket }, false],
      [
        "tweak",
        { toy: tuned, display: pocket, tweaks: { enabled: false } },
        true,
      ],
    ],
  },
  autoFit: {
    read: (look) => look.canvasStyle["--emulated-canvas-scale"] !== undefined,
    rungs: [
      ["default", { toy: tuned, display: pocket }, true],
      [
        "tweak",
        { toy: tuned, display: pocket, tweaks: { autoFit: false } },
        false,
      ],
    ],
  },
  scale: {
    read: (look) => look.data.scale,
    rungs: [
      ["default", { toy: tuned, display: pocket }, "7"],
      ["tweak", { toy: tuned, display: pocket, tweaks: { scale: 12 } }, "12"],
    ],
  },
  gap: {
    read: (look) => look.data.gap,
    rungs: [
      ["default", {}, "3"],
      ["display", { display: pocket }, String(screen.gap)],
      ["tweak", { display: pocket, tweaks: { gap: 5 } }, "5"],
    ],
  },
  shape: {
    read: (look) => look.data.shape,
    rungs: [
      ["default", { toy: tuned, display: pocket }, "circle"],
      [
        "tweak",
        { toy: tuned, display: pocket, tweaks: { shape: "hex" } },
        "hex",
      ],
    ],
  },
  // A display's ghost is its own rise and fall, which outrank the ghost the
  // canvas is also given.
  ghost: {
    read: ({ data }) => [data.ghost, data.ghostRise, data.ghostFall],
    rungs: [
      ["default", {}, ["70", undefined, undefined]],
      ["toy", { toy: tuned }, ["55", undefined, undefined]],
      [
        "display",
        { toy: tuned, display: pocket },
        ["55", String(screen.ghostRise), String(screen.ghostFall)],
      ],
      [
        "tweak",
        { toy: tuned, display: pocket, tweaks: { ghost: 20 } },
        ["20", undefined, undefined],
      ],
    ],
  },
  noise: {
    read: (look) => look.data.noise,
    rungs: [
      ["default", {}, "18"],
      ["toy", { toy: tuned }, "12"],
      ["display", { toy: tuned, display: pocket }, "0"],
      ["tweak", { toy: tuned, display: pocket, tweaks: { noise: 30 } }, "30"],
    ],
  },
  noiseScale: {
    read: (look) => look.data.noiseScale,
    rungs: [
      ["default", { toy: tuned, display: pocket }, "30"],
      [
        "tweak",
        { toy: tuned, display: pocket, tweaks: { noiseScale: 10 } },
        "20",
      ],
    ],
  },
  noiseSpeed: {
    read: (look) => look.data.noiseSpeed,
    rungs: [
      ["default", { toy: tuned, display: pocket }, "5"],
      [
        "tweak",
        { toy: tuned, display: pocket, tweaks: { noiseSpeed: 9 } },
        "9",
      ],
    ],
  },
  // The screen behind the canvas is the base too, so the gaps and the strip
  // past the grid follow it.
  lightBase: {
    read: ({ data, hostStyle }) => [
      data.paletteBase,
      hostStyle["--backdrop-display-screen"],
    ],
    rungs: [
      ["default", {}, [DEFAULTS.lightBase, undefined]],
      ["display", { display: pocket }, [screen.base, screen.base]],
      [
        "tweak",
        { display: pocket, tweaks: { lightBase: "#123456" } },
        ["#123456", "#123456"],
      ],
    ],
  },
  lightInk: {
    read: (look) => look.data.paletteInk,
    rungs: [
      ["default", {}, DEFAULTS.lightInk],
      ["display", { display: pocket }, screen.ink],
      [
        "tweak",
        { display: pocket, tweaks: { lightInk: "#123456" } },
        "#123456",
      ],
    ],
  },
  darkBase: {
    read: ({ data, hostStyle }) => [
      data.paletteBase,
      hostStyle["--backdrop-display-screen"],
    ],
    rungs: [
      ["default", { scheme: "dark" }, [DEFAULTS.darkBase, undefined]],
      [
        "display",
        { scheme: "dark", display: pocket },
        [screen.base, screen.base],
      ],
      [
        "tweak",
        { scheme: "dark", display: pocket, tweaks: { darkBase: "#123456" } },
        ["#123456", "#123456"],
      ],
    ],
  },
  darkInk: {
    read: (look) => look.data.paletteInk,
    rungs: [
      ["default", { scheme: "dark" }, DEFAULTS.darkInk],
      ["display", { scheme: "dark", display: pocket }, screen.ink],
      [
        "tweak",
        { scheme: "dark", display: pocket, tweaks: { darkInk: "#123456" } },
        "#123456",
      ],
    ],
  },
};

const rungs = Object.entries(ladders).flatMap(([knob, { read, rungs }]) =>
  rungs.map(([source, input, shown]) => ({ knob, source, read, input, shown })),
);

test("every knob has a precedence ladder", () => {
  expect(Object.keys(ladders).sort()).toEqual(Object.keys(KNOBS).sort());
});

test.each(rungs)(
  "$knob shows the $source when nothing above it is set",
  ({ read, input, shown }) => {
    expect(read(resolve(input))).toEqual(shown);
  },
);

test.each(Object.entries(ladders))(
  "each of %s's rungs shows something the one below does not, so it proves the order",
  (_, { rungs }) => {
    const shown = rungs.map(([, , value]) => value);
    for (let at = 1; at < shown.length; at += 1) {
      expect(shown[at]).not.toEqual(shown[at - 1]);
    }
  },
);

const SCHEMES = ["light", "dark"] as const;

/** Every toy, display and scheme, with nothing tweaked. */
const COMBINATIONS: Partial<LookInput>[] = DISPLAYS.flatMap((display) =>
  [plain, tuned].flatMap((toy) =>
    SCHEMES.map((scheme) => ({ display, toy, scheme })),
  ),
);

const singleSourced = Object.entries(ladders).filter(
  ([, { rungs }]) => rungs.length === 2,
);

test.each(singleSourced)(
  "only a tweak moves %s, whatever the toy, display or scheme",
  (_, { read, rungs }) => {
    const [[, , byDefault]] = rungs;
    for (const input of COMBINATIONS) {
      expect(read(resolve(input))).toEqual(byDefault);
    }
  },
);

const SHAPES = {
  square: true,
  circle: true,
  ring: true,
  diamond: true,
  hex: true,
  triangle: true,
  dash: true,
  slash: true,
  cross: true,
} satisfies Record<BackdropKnobs["shape"], true>;

test("the shape knob offers every shape the canvas draws", () => {
  expect(Object.keys(SHAPES)).toEqual([...CANVAS_SHAPES]);
});

/** Another valid value for the knob than its default. */
function another(key: keyof BackdropKnobs): unknown {
  const current = DEFAULTS[key];
  if (key === "shape") {
    return Object.keys(SHAPES).find((shape) => shape !== current);
  }
  switch (typeof current) {
    case "number":
      return current + 1;
    case "boolean":
      return !current;
    default:
      expect(current, `give ${key}'s choices here`).toMatch(/^#/);
      return current === "#010203" ? "#030201" : "#010203";
  }
}

const moves = (changed: Partial<LookInput>, inputs = COMBINATIONS) =>
  inputs.some(
    (input) =>
      !isDeepStrictEqual(resolve({ ...input, ...changed }), resolve(input)),
  );

test.each(Object.keys(KNOBS) as (keyof BackdropKnobs)[])(
  "the %s knob's default changes the look in some toy, display or scheme",
  (key) => {
    const defaults = { ...DEFAULTS, [key]: another(key) };
    expect(moves({ defaults }), `the ${key} knob changes nothing`).toBe(true);
  },
);

type Fields = { [field: string]: string | number | boolean | Fields };

/** Each field of a look as a path, nested ones included. */
const fieldsOf = (look: Fields, path: string[] = []): string[][] =>
  Object.entries(look).flatMap(([key, value]) =>
    typeof value === "object"
      ? fieldsOf(value, [...path, key])
      : [[...path, key]],
  );

function withChanged(display: Display, path: string[]): Display {
  const look = structuredClone(display.look) as unknown as Fields;
  const parent = path.slice(0, -1).reduce((at, key) => at[key] as Fields, look);
  const field = path.at(-1)!;
  const value = parent[field];
  parent[field] =
    typeof value === "number"
      ? value + 1
      : typeof value === "boolean"
        ? !value
        : typeof value === "string" && /^#[0-9a-f]{6}$/.test(value)
          ? value === "#010203"
            ? "#030201"
            : "#010203"
          : `${value} changed`;
  return { ...display, look: look as unknown as Display["look"] };
}

type Complete<T> = {
  [K in keyof T]-?: Complete<NonNullable<T[K]>>;
};

/** Sets every field a display can, so a new one must be added here, and so is tested. */
const complete: Display = {
  id: "complete",
  label: "Complete",
  look: {
    grid: "#0000000a",
    vignette: { clear: 33, edge: "#e6d3d3" },
    base: "#f89b03",
    ink: "#3c070d",
    stops: ["#2bd96b", "#e3f01c"],
    levels: 2,
    dither: true,
    gap: 1,
    ghostRise: 86,
    ghostFall: 76,
    shadow: { opacity: 25, x: 4, y: 4 },
  } satisfies Complete<DisplayLook>,
};

const displayFields = fieldsOf(complete.look as unknown as Fields).map(
  (path) => ({ field: path.join("."), path }),
);

test.each(displayFields)(
  "a display's $field changes the look",
  ({ path, field }) => {
    const inputs = COMBINATIONS.map((input) => ({
      ...input,
      display: complete,
    }));
    expect(
      moves({ display: withChanged(complete, path) }, inputs),
      `the display field ${field} changes nothing`,
    ).toBe(true);
  },
);

test("a display colours the canvas and the screen behind it, and lays its grid, shadow and ghost over a tuned toy", () => {
  const look = resolve({ toy: tuned, display: pocket });
  expect(screen.grid).toBeDefined();

  expect(look.data).toMatchObject({
    gap: String(screen.gap),
    ghost: "55",
    ghostRise: String(screen.ghostRise),
    ghostFall: String(screen.ghostFall),
    noise: "0",
    shadow: String(screen.shadow!.opacity),
    shadowX: String(screen.shadow!.x),
    shadowY: String(screen.shadow!.y),
    paletteBase: screen.base,
    paletteInk: screen.ink,
    paletteLevels: String(screen.levels),
  });
  expect(look.hostStyle).toEqual({
    "--backdrop-display-screen": screen.base,
    "--backdrop-display-grid": screen.grid,
    "--backdrop-display-vignette": undefined,
  });
  expect(look.hostFlags["data-vignette"]).toBe(false);
});

test("only a display with a backlight vignette lays one over the screen, and one without a grid leaves the gaps the screen's", () => {
  const look = resolve({ display: amber });
  expect(amber.look!.vignette).toBeDefined();

  expect(look.hostStyle).toEqual({
    "--backdrop-display-screen": amber.look!.base,
    "--backdrop-display-grid": undefined,
    "--backdrop-display-vignette": AMBER_VIGNETTE,
  });
  expect(look.hostFlags["data-vignette"]).toBe(true);
  for (const key of ["shadow", "shadowX", "shadowY"]) {
    expect(look.data[key]).toBeUndefined();
  }
});

/**
 * Amber multiplies its screen #f89b03 by #e6d3d3 at the corners, darkening
 * red by 25/255 and green and blue by 44/255. The overlay takes the larger,
 * 44/255 = 0.173, as its alpha, and as its colour the screen times each
 * channel's shortfall from it, red 248·(44 − 25)/44 = 107.
 */
const AMBER_VIGNETTE =
  "radial-gradient(farthest-corner, transparent 33%, rgb(107 0 0 / 0.173))";

test("Amber's vignette is plain paint that darkens its screen exactly as its tuned multiply would", () => {
  expect(amber.look!.vignette).toEqual({ clear: 33, edge: "#e6d3d3" });

  expect(resolve({ display: amber }).hostStyle).toMatchObject({
    "--backdrop-display-vignette": AMBER_VIGNETTE,
  });
});

test("a tweaked base colours the screen the vignette darkens", () => {
  expect(
    resolve({ display: amber, tweaks: { lightBase: "#ffffff" } }).hostStyle,
  ).toMatchObject({
    "--backdrop-display-screen": "#ffffff",
    "--backdrop-display-vignette":
      "radial-gradient(farthest-corner, transparent 33%, rgb(110 0 0 / 0.173))",
  });
});

test("Site sets none of a display's attributes or properties, and shows the toy's own look", () => {
  const look = resolve({ toy: tuned, display: site });

  for (const key of [
    "ghostRise",
    "ghostFall",
    "shadow",
    "shadowX",
    "shadowY",
    "paletteLevels",
    "paletteDither",
  ]) {
    expect(look.data[key]).toBeUndefined();
  }
  expect(Object.values(look.hostStyle)).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
  expect(look.hostFlags["data-vignette"]).toBe(false);
  expect(look.data).toMatchObject({ ghost: "55", noise: "12" });
});

test("the palette is the scheme's on Site, and a display's in either scheme", () => {
  const palette = (input: Partial<LookInput>) => {
    const { paletteBase, paletteInk } = resolve(input).data;
    return [paletteBase, paletteInk];
  };

  expect(palette({})).toEqual([DEFAULTS.lightBase, DEFAULTS.lightInk]);
  expect(palette({ scheme: "dark" })).toEqual([
    DEFAULTS.darkBase,
    DEFAULTS.darkInk,
  ]);
  expect(palette({ display: pocket, scheme: "dark" })).toEqual(
    palette({ display: pocket }),
  );
});

test("the noise's feature size reaches the canvas in its own pixels, scaled from the tuned width", () => {
  expect(resolve({ tweaks: { noiseScale: 15 } }).data.noiseScale).toBe("30");
  expect(resolve({ columns: 80 }).data.noiseScale).toBe("15");
});

test("auto-fit tiles the viewport's larger side with whole strides of the grid, the effective gap taken out of each", () => {
  const fit = (input: Partial<LookInput>) =>
    resolve(input).canvasStyle["--emulated-canvas-scale"];

  expect(fit({ tweaks: { gap: 2 } })).toBe(
    "max(1px, round(up, max(100lvw, 100lvh) / 160, 1px) - 2px)",
  );
  expect(fit({ display: amber })).toContain(`) - ${amber.look!.gap}px)`);
  expect(fit({ display: amber, tweaks: { gap: 5 } })).toContain(") - 5px)");
  expect(fit({ tweaks: { autoFit: false } })).toBeUndefined();
});

test("a tweaked knob sets no custom property on the canvas", () => {
  const look = resolve({
    tweaks: { ghost: 30, gap: 3, lightInk: "#123456" },
  });

  expect(Object.keys(look.canvasStyle)).toEqual(["--emulated-canvas-scale"]);
});

test("the defaults set as tweaks are not a fresh start: they outrank a display", () => {
  expect(resolve({ display: pocket, tweaks: { ...DEFAULTS } })).not.toEqual(
    resolve({ display: pocket }),
  );
});

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

test("the same input gives the same look, and is left as it was", () => {
  const input = deepFreeze({
    ...FRESH,
    defaults: { ...DEFAULTS },
    tweaks: { gap: 4 },
    toy: toy("frozen", { ghost: 40, noise: 9 }),
    display: structuredClone(pocket),
  });

  expect(resolveLook(input)).toEqual(resolveLook(input));
});

const attribute = (key: string) =>
  `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

test("the canvas observes every attribute a look writes, so a live switch of display reaches it", () => {
  const written = new Set(
    COMBINATIONS.flatMap((input) =>
      Object.keys(resolve(input).data).map(attribute),
    ),
  );
  const unobserved = [...written].filter(
    (name) => !EmulatedCanvas.observedAttributes.includes(name),
  );
  expect(unobserved, "observe these on <emulated-canvas>").toEqual([]);
});
