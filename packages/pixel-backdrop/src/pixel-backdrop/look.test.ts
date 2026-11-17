import { isDeepStrictEqual } from "node:util";
import { expect, test } from "vitest";
import { DISPLAYS } from "../test/displays";
import type { BackdropDisplay, DisplayLook } from "./display";
import type { Toy } from "../backdrop-toys/toy";
import { EmulatedCanvas } from "../emulated-canvas/element";
import { SHAPES as CANVAS_SHAPES } from "../emulated-canvas/presenter";
import { KNOBS, type BackdropKnobs, type KnobDefaults } from "./knobs";
import { resolveLook, type LookInput, type ResolvedLook } from "./look";

/** Each value apart from every source that can stand in for it, so a case shows which one won. */
const DEFAULTS: KnobDefaults = {
  enabled: true,
  autoFit: true,
  scale: 7,
  gap: 3,
  shape: "circle",
  ghost: 70,
  noise: 18,
  noiseScale: 15,
  noiseSpeed: 5,
};

const toy = (id: string, look?: Toy["look"]): Toy => ({
  id,
  label: id,
  look,
  start: () => () => {},
});
const plain = toy("plain");
const tuned = toy("tuned", { ghost: 55, noise: 12 });

const { light, panel, backlit } = DISPLAYS;
const screen = panel.look;

const FRESH: LookInput = {
  defaults: DEFAULTS,
  tweaks: {},
  toy: plain,
  display: light,
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
      ["default", { toy: tuned, display: panel }, false],
      [
        "tweak",
        { toy: tuned, display: panel, tweaks: { enabled: false } },
        true,
      ],
    ],
  },
  autoFit: {
    read: (look) => look.canvasStyle["--emulated-canvas-scale"] !== undefined,
    rungs: [
      ["default", { toy: tuned, display: panel }, true],
      [
        "tweak",
        { toy: tuned, display: panel, tweaks: { autoFit: false } },
        false,
      ],
    ],
  },
  scale: {
    read: (look) => look.data.scale,
    rungs: [
      ["default", { toy: tuned, display: panel }, "7"],
      ["tweak", { toy: tuned, display: panel, tweaks: { scale: 12 } }, "12"],
    ],
  },
  gap: {
    read: (look) => look.data.gap,
    rungs: [
      ["default", {}, "3"],
      ["display", { display: panel }, String(screen.gap)],
      ["tweak", { display: panel, tweaks: { gap: 5 } }, "5"],
    ],
  },
  shape: {
    read: (look) => look.data.shape,
    rungs: [
      ["default", { toy: tuned, display: panel }, "circle"],
      [
        "tweak",
        { toy: tuned, display: panel, tweaks: { shape: "hex" } },
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
        { toy: tuned, display: panel },
        ["55", String(screen.ghostRise), String(screen.ghostFall)],
      ],
      [
        "tweak",
        { toy: tuned, display: panel, tweaks: { ghost: 20 } },
        ["20", undefined, undefined],
      ],
    ],
  },
  noise: {
    read: (look) => look.data.noise,
    rungs: [
      ["default", {}, "18"],
      ["toy", { toy: tuned }, "12"],
      ["display", { toy: tuned, display: panel }, "0"],
      ["tweak", { toy: tuned, display: panel, tweaks: { noise: 30 } }, "30"],
    ],
  },
  noiseScale: {
    read: (look) => look.data.noiseScale,
    rungs: [
      ["default", { toy: tuned, display: panel }, "30"],
      [
        "tweak",
        { toy: tuned, display: panel, tweaks: { noiseScale: 10 } },
        "20",
      ],
    ],
  },
  noiseSpeed: {
    read: (look) => look.data.noiseSpeed,
    rungs: [
      ["default", { toy: tuned, display: panel }, "5"],
      ["tweak", { toy: tuned, display: panel, tweaks: { noiseSpeed: 9 } }, "9"],
    ],
  },
  // The screen behind the canvas is the base too, so the gaps and the strip
  // past the grid follow it; a plain display has no screen.
  base: {
    read: ({ data, hostStyle }) => [
      data.paletteBase,
      hostStyle["--backdrop-display-screen"],
    ],
    rungs: [
      ["the plain display's", {}, [light.base, undefined]],
      ["display", { display: panel }, [panel.base, panel.base]],
      [
        "tweak",
        { display: panel, tweaks: { base: "#123456" } },
        ["#123456", "#123456"],
      ],
    ],
  },
  ink: {
    read: (look) => look.data.paletteInk,
    rungs: [
      ["the plain display's", {}, light.ink],
      ["display", { display: panel }, panel.ink],
      ["tweak", { display: panel, tweaks: { ink: "#123456" } }, "#123456"],
    ],
  },
};

const rungs = Object.entries(ladders).flatMap(([knob, { read, rungs }]) =>
  rungs.map(([source, input, shown]) => ({ knob, source, read, input, shown })),
);

test("every knob has a precedence ladder", () => {
  expect(Object.keys(ladders).sort()).toEqual(
    [...Object.keys(KNOBS), "base", "ink"].sort(),
  );
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

/** Every toy and display, with nothing tweaked. */
const COMBINATIONS: Partial<LookInput>[] = Object.values(DISPLAYS).flatMap(
  (display) => [plain, tuned].map((toy) => ({ display, toy })),
);

const singleSourced = Object.entries(ladders).filter(
  ([, { rungs }]) => rungs.length === 2,
);

test.each(singleSourced)(
  "only a tweak moves %s, whatever the toy or display",
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
function another(key: keyof KnobDefaults): unknown {
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
      throw new Error(`give ${key}'s choices here`);
  }
}

const moves = (changed: Partial<LookInput>, inputs = COMBINATIONS) =>
  inputs.some(
    (input) =>
      !isDeepStrictEqual(resolve({ ...input, ...changed }), resolve(input)),
  );

test.each(Object.keys(KNOBS) as (keyof KnobDefaults)[])(
  "the %s knob's default changes the look in some toy or display",
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

function withChanged(
  display: BackdropDisplay,
  path: string[],
): BackdropDisplay {
  const changed = structuredClone(display) as unknown as Fields;
  const parent = path
    .slice(0, -1)
    .reduce((at, key) => at[key] as Fields, changed);
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
  return changed as unknown as BackdropDisplay;
}

type Complete<T> = {
  [K in keyof T]-?: Complete<NonNullable<T[K]>>;
};

/** Sets every field a display can, so a new one must be added here, and so is tested. */
const complete: BackdropDisplay = {
  base: "#f89b03",
  ink: "#3c070d",
  look: {
    grid: "#0000000a",
    vignette: { clear: 33, edge: "#e6d3d3" },
    stops: ["#2bd96b", "#e3f01c"],
    levels: 2,
    dither: true,
    gap: 1,
    ghostRise: 86,
    ghostFall: 76,
    shadow: { opacity: 25, x: 4, y: 4 },
  } satisfies Complete<DisplayLook>,
};

const displayFields = fieldsOf(complete as unknown as Fields).map((path) => ({
  field: path.join("."),
  path,
}));

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
  const look = resolve({ toy: tuned, display: panel });
  expect(screen.grid).toBeDefined();

  expect(look.data).toMatchObject({
    gap: String(screen.gap),
    ghost: "55",
    ghostRise: String(screen.ghostRise),
    ghostFall: String(screen.ghostFall),
    noise: "0",
    shadow: String(screen.shadow.opacity),
    shadowX: String(screen.shadow.x),
    shadowY: String(screen.shadow.y),
    paletteBase: panel.base,
    paletteInk: panel.ink,
    paletteLevels: String(screen.levels),
  });
  expect(look.hostStyle).toEqual({
    "--backdrop-display-screen": panel.base,
    "--backdrop-display-grid": screen.grid,
    "--backdrop-display-vignette": undefined,
  });
  expect(look.hostFlags["data-vignette"]).toBe(false);
});

test("only a display with a backlight vignette lays one over the screen, and one without a grid leaves the gaps the screen's", () => {
  const look = resolve({ display: backlit });
  expect(backlit.look.vignette).toBeDefined();

  expect(look.hostStyle).toEqual({
    "--backdrop-display-screen": backlit.base,
    "--backdrop-display-grid": undefined,
    "--backdrop-display-vignette": BACKLIT_VIGNETTE,
  });
  expect(look.hostFlags["data-vignette"]).toBe(true);
  for (const key of ["shadow", "shadowX", "shadowY"]) {
    expect(look.data[key]).toBeUndefined();
  }
});

/**
 * The backlit display multiplies its screen #f89b03 by #e6d3d3 at the corners, darkening
 * red by 25/255 and green and blue by 44/255. The overlay takes the larger,
 * 44/255 = 0.173, as its alpha, and as its colour the screen times each
 * channel's shortfall from it, red 248·(44 − 25)/44 = 107.
 */
const BACKLIT_VIGNETTE =
  "radial-gradient(farthest-corner, transparent 33%, rgb(107 0 0 / 0.173))";

test("a vignette is plain paint that darkens its screen exactly as its tuned multiply would", () => {
  expect(backlit.look.vignette).toEqual({ clear: 33, edge: "#e6d3d3" });

  expect(resolve({ display: backlit }).hostStyle).toMatchObject({
    "--backdrop-display-vignette": BACKLIT_VIGNETTE,
  });
});

test("a tweaked base colours the screen the vignette darkens", () => {
  expect(
    resolve({ display: backlit, tweaks: { base: "#ffffff" } }).hostStyle,
  ).toMatchObject({
    "--backdrop-display-screen": "#ffffff",
    "--backdrop-display-vignette":
      "radial-gradient(farthest-corner, transparent 33%, rgb(110 0 0 / 0.173))",
  });
});

test("a plain display sets none of a display's attributes or properties, and shows the toy's own look", () => {
  const look = resolve({ toy: tuned, display: light });

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

test.each(Object.entries(DISPLAYS))(
  "the canvas is in %s's palette",
  (_, display) => {
    const { paletteBase, paletteInk } = resolve({ display }).data;

    expect([paletteBase, paletteInk]).toEqual([display.base, display.ink]);
  },
);

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
  expect(fit({ display: backlit })).toContain(`) - ${backlit.look.gap}px)`);
  expect(fit({ display: backlit, tweaks: { gap: 5 } })).toContain(") - 5px)");
  expect(fit({ tweaks: { autoFit: false } })).toBeUndefined();
});

test("a tweaked knob sets no custom property on the canvas", () => {
  const look = resolve({
    tweaks: { ghost: 30, gap: 3, ink: "#123456" },
  });

  expect(Object.keys(look.canvasStyle)).toEqual(["--emulated-canvas-scale"]);
});

test("the defaults set as tweaks are not a fresh start: they outrank a display", () => {
  expect(resolve({ display: panel, tweaks: { ...DEFAULTS } })).not.toEqual(
    resolve({ display: panel }),
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
    display: structuredClone(panel),
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

test.each([
  [
    "a picture on a dark ink",
    { toy: { ...plain, picture: true }, display: panel },
    "",
  ],
  [
    "a picture on a light ink",
    { toy: { ...plain, picture: true }, display: DISPLAYS.dark },
    undefined,
  ],
  ["a drawing on a dark ink", { toy: plain, display: panel }, undefined],
  [
    "a picture on a dark ink tweaked light",
    {
      toy: { ...plain, picture: true },
      display: panel,
      tweaks: { ink: "#ffffff" },
    },
    undefined,
  ],
] satisfies [string, Partial<LookInput>, unknown][])(
  "%s inverts the palette only where it would otherwise show as a negative",
  (_, input, invert) => {
    expect(resolve(input).data.paletteInvert).toBe(invert);
  },
);
