import { beforeAll, describe, expect, test, vi } from "vitest";
import { installBackdropDefaults } from "../../test/backdrop-defaults";
import { mulberry32 } from "../backdrop-noise";
import { MAX_GHOST } from "../emulated-canvas-limits";
import { readDefaults } from "../pixel-backdrop";
import { MODES } from ".";
import { GRID_SIZE, type BackdropInput, type Mode, type Pace } from "./mode";

const COLUMNS = GRID_SIZE;
const ROWS = GRID_SIZE;

/** Noise samples, `random()` draws and costly `Math` calls since the last reset. */
const work = vi.hoisted(() => ({ count: 0 }));

vi.mock("../backdrop-noise", async (importOriginal) => {
  const noise = await importOriginal<typeof import("../backdrop-noise")>();
  return {
    ...noise,
    makeNoise2D(seed: number) {
      const sample = noise.makeNoise2D(seed);
      return (x: number, y: number) => {
        work.count += 1;
        return sample(x, y);
      };
    },
  };
});

/**
 * Modes allowed to rest at "idle" (the ~8 fps timer) rather than "still" once
 * input stops. Only an ambient mode that keeps animating on its own belongs
 * here, with the reason beside it; every other mode must stop asking for
 * frames, so an untouched tab costs nothing.
 */
const RESTING_PACE: Record<string, Pace> = {};

/** How long after the last input a mode may stay "active". */
const SETTLE_MS = 30_000;

/**
 * Per step + render, in noise samples, `random()` draws and costly `Math`
 * calls: room for about two per cell.
 */
const WORK_BUDGET = 2 * COLUMNS * ROWS;

/** A 16:9 viewport over the square grid, which overhangs it top and bottom. */
const VISIBLE = {
  left: 0,
  top: (ROWS * 7) / 32,
  right: COLUMNS,
  bottom: (ROWS * 25) / 32,
};
const STEP = 1000 / 60;
/** Fixed only so a failure reproduces; every assertion holds for any seed. */
const SEED = 1;

const INPUT_STEPS = 150;
const SESSION_STEPS = INPUT_STEPS + Math.ceil(35_000 / STEP);

/** A point `share` of the way along the visible rect's diagonal. */
function across(share: number) {
  return {
    x: VISIBLE.left + share * (VISIBLE.right - VISIBLE.left),
    y: VISIBLE.top + share * (VISIBLE.bottom - VISIBLE.top),
  };
}

/**
 * The scripted session, as the host would report it: a hover sweep down the
 * diagonal, a press-and-hold dragged back up it, a tap in the middle, then the
 * pointer leaves and nothing happens for the rest of the session.
 */
function feed(input: BackdropInput, i: number, now: number) {
  if (i < 120) input.pointer = across(i < 60 ? i / 60 : (120 - i) / 60);
  if (i === 60) input.press = { ...input.pointer!, at: now, held: true };
  if (i === 135) input.press = { ...across(0.5), at: now, held: true };
  if (i === 120 || i === 138) input.press!.held = false;
  if (i === INPUT_STEPS) input.pointer = undefined;
  if (i < 120 || i === 135) input.lastInputAt = now;
}

/** Same as `feed`, but the pointer stops over empty space and never leaves. */
function feedResting(input: BackdropInput, i: number, now: number) {
  feed(input, i, now);
  if (i >= INPUT_STEPS) input.pointer = across(0.5);
}

/** One mode instance driven like the host drives it. */
function start(
  mode: Mode,
  { startAt = 0, lastInputAt = -Infinity, script = feed } = {},
) {
  const random = mulberry32(SEED);
  const instance = mode.create({
    columns: COLUMNS,
    rows: ROWS,
    random: () => {
      work.count += 1;
      return random();
    },
    options: readDefaults(),
  });
  const field = new Float32Array(COLUMNS * ROWS);
  const input: BackdropInput = { lastInputAt, visible: VISIBLE };
  let now = startAt;
  return {
    field,
    /** Steps and renders the script's `i`th step, returning the pace between. */
    frame(i: number) {
      now += STEP;
      script(input, i, now);
      instance.step(input, now);
      const pace = instance.pace();
      field.fill(0);
      instance.render(field);
      return pace;
    },
    jump(ms: number) {
      now += ms;
    },
  };
}

function inRange(field: Float32Array) {
  return field.every((value) => value >= 0 && value <= 1);
}

const COSTLY_MATH = [
  "sqrt",
  "cbrt",
  "hypot",
  "exp",
  "log",
  "pow",
  "sin",
  "cos",
  "tan",
  "atan2",
] as const;

/** Counts calls to the costly `Math` functions into `work` until restored. */
function countMath() {
  const originals = COSTLY_MATH.map((name) => [name, Math[name]] as const);
  for (const [name, original] of originals) {
    const call = original as (...args: number[]) => number;
    Object.assign(Math, {
      [name]: (...args: number[]) => {
        work.count += 1;
        return call(...args);
      },
    });
  }
  return () => {
    for (const [name, original] of originals) {
      Object.assign(Math, { [name]: original });
    }
  };
}

const BUFFERS = [
  "ArrayBuffer",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "ImageData",
  "Path2D",
  "OffscreenCanvas",
] as const;

/** Arrays this long are buffers, not a handful of bookkeeping values. */
const LARGE_ARRAY = 64;

/**
 * Counts buffers, canvases and large arrays made until `restore`. Small
 * objects are left alone: they are cheap, and modes make them freely.
 */
function countAllocations() {
  let count = 0;
  const large = (length: unknown) =>
    typeof length === "number" && length > LARGE_ARRAY;

  // Array literals and spreads are invisible, but the copying methods are not: any call, however small, is a per-step allocation.
  type Copier = (this: unknown, ...args: unknown[]) => unknown;
  const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
  type Owned = [Record<string, Copier>, string];
  const copiers: Owned[] = [
    ...["slice", "map", "filter"].map((name): Owned => [typedArray, name]),
    ...["slice", "map", "filter", "concat", "flat", "flatMap", "toSorted"].map(
      (name): Owned => [Array.prototype as never, name],
    ),
    [Array as never, "from"],
  ];
  const originals = copiers.map(([owner, name]) => owner[name]);
  copiers.forEach(([owner, name], index) => {
    const original = originals[index];
    owner[name] = function (...args) {
      const result = original.apply(this, args);
      count += 1;
      return result;
    };
  });

  const counted = (target: object, counts = (_args: unknown[]) => true) =>
    new Proxy(target as new (...args: unknown[]) => object, {
      apply(target, self, args) {
        if (counts(args)) count += 1;
        return Reflect.apply(target, self, args);
      },
      construct(target, args, newTarget) {
        if (counts(args)) count += 1;
        return Reflect.construct(target, args, newTarget);
      },
    });
  const globals = globalThis as unknown as Record<string, object | undefined>;
  for (const name of BUFFERS) {
    vi.stubGlobal(name, counted(globals[name] ?? class {}));
  }
  vi.stubGlobal(
    "Array",
    counted(Array, (args) => args.length === 1 && large(args[0])),
  );

  return {
    count: () => count,
    restore() {
      vi.unstubAllGlobals();
      copiers.forEach(([owner, name], index) => {
        owner[name] = originals[index];
      });
    },
  };
}

beforeAll(installBackdropDefaults);

test("only registered modes are allowed to rest idle", () => {
  const ids = MODES.map((mode) => mode.id);
  expect(ids).toEqual(expect.arrayContaining(Object.keys(RESTING_PACE)));
});

test("the allocation count catches a mode that copies a buffer every frame", () => {
  const leaky: Mode = {
    id: "leaky",
    label: "Leaky",
    create: () => ({
      step() {},
      render: (field) => field.set(field.slice()),
      pace: () => "still",
    }),
  };
  const session = start(leaky);
  const allocations = countAllocations();
  try {
    for (let i = 0; i < 10; i += 1) session.frame(i);
  } finally {
    allocations.restore();
  }
  expect(allocations.count()).toBe(10);
});

describe.each(MODES.map((mode) => [mode.id, mode] as const))(
  "%s",
  (id, mode) => {
    test("has a look, if any, within 0–100 and under the canvas's ghost cap", () => {
      const { ghost = 0, noise = 0 } = mode.look ?? {};
      expect(ghost).toBeGreaterThanOrEqual(0);
      expect(ghost).toBeLessThanOrEqual(MAX_GHOST * 100);
      expect(noise).toBeGreaterThanOrEqual(0);
      expect(noise).toBeLessThanOrEqual(100);
    });

    test("keeps every field value finite and within 0–1", () => {
      const session = start(mode);
      const badSteps: number[] = [];
      for (let i = 0; i < SESSION_STEPS; i += 1) {
        session.frame(i);
        if (!inRange(session.field)) badSteps.push(i);
      }
      expect(badSteps).toEqual([]);
    });

    test(`rests within ${SETTLE_MS / 1000} s of the last input`, () => {
      const session = start(mode);
      const resting = new Set<Pace>(["still", RESTING_PACE[id] ?? "still"]);
      const settledFrom = INPUT_STEPS + Math.ceil(SETTLE_MS / STEP);
      const restless: Pace[] = [];
      for (let i = 0; i < SESSION_STEPS; i += 1) {
        const pace = session.frame(i);
        if (i >= settledFrom && !resting.has(pace)) restless.push(pace);
      }
      expect(restless).toEqual([]);
    });

    test("rests within the settle bound with the pointer resting over empty space", () => {
      const session = start(mode, { script: feedResting });
      const resting = new Set<Pace>(["still", RESTING_PACE[id] ?? "still"]);
      const settledFrom = INPUT_STEPS + Math.ceil(SETTLE_MS / STEP);
      const restless: Pace[] = [];
      for (let i = 0; i < SESSION_STEPS; i += 1) {
        const pace = session.frame(i);
        if (i >= settledFrom && !resting.has(pace)) restless.push(pace);
      }
      expect(restless).toEqual([]);
    });

    test.each([0, 30_000])(
      "created a minute in with the last input at %i ms, it stays in range and settles with no input",
      (lastInputAt) => {
        const session = start(mode, {
          startAt: 60_000,
          lastInputAt,
          script: () => {},
        });
        const resting = new Set<Pace>(["still", RESTING_PACE[id] ?? "still"]);
        const settledFrom = Math.ceil(SETTLE_MS / STEP);
        const restless: Pace[] = [];
        for (let i = 0; i < SESSION_STEPS; i += 1) {
          const pace = session.frame(i);
          expect(inRange(session.field)).toBe(true);
          if (i >= settledFrom && !resting.has(pace)) restless.push(pace);
        }
        expect(restless).toEqual([]);
      },
    );

    test("allocates no buffers, large arrays or array copies per frame once warmed up", () => {
      const session = start(mode);
      for (let i = 0; i < SESSION_STEPS; i += 1) session.frame(i);

      const allocations = countAllocations();
      try {
        for (let i = 0; i < SESSION_STEPS; i += 1) session.frame(i);
      } finally {
        allocations.restore();
      }
      expect(allocations.count()).toBe(0);
    });

    test("keeps every frame within the work budget", () => {
      const session = start(mode);
      let most = 0;
      const restore = countMath();
      try {
        for (let i = 0; i < SESSION_STEPS; i += 1) {
          work.count = 0;
          session.frame(i);
          most = Math.max(most, work.count);
        }
      } finally {
        restore();
      }
      expect(most).toBeLessThanOrEqual(WORK_BUDGET);
    });

    test("survives the clock jumping an hour mid-gesture", () => {
      const session = start(mode);
      for (let i = 0; i < 90; i += 1) session.frame(i);

      session.jump(60 * 60 * 1000);
      work.count = 0;
      const restore = countMath();
      let pace: Pace;
      try {
        pace = session.frame(90);
      } finally {
        restore();
      }
      expect(work.count).toBeLessThanOrEqual(WORK_BUDGET);
      expect(["active", "idle", "still"]).toContain(pace);
      expect(inRange(session.field)).toBe(true);

      for (let i = 91; i < SESSION_STEPS; i += 1) session.frame(i);
      expect(inRange(session.field)).toBe(true);
    });
  },
);
