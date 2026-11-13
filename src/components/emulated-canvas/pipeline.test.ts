import { expect, test } from "vitest";
import { Pipeline } from "./pipeline";
import type { Pace, Shader, ShaderFrame } from "./shader";

const FRAME: ShaderFrame = { width: 2, height: 1, elapsedMs: 16 };

/** A shader whose pass is on while `data[name]` is set, logs each apply and reports `pace`. */
function fake(name: string, log: string[], pace: Pace = "still"): Shader {
  let built = 0;
  return {
    attributes: [`data-${name}`],
    create() {
      built += 1;
      const instance = built;
      let on = false;
      let applied = 0;
      return {
        configure(data) {
          on = data[name] !== undefined;
        },
        active: () => on,
        apply() {
          applied += 1;
          log.push(`${name}#${instance} apply ${applied}`);
          return pace;
        },
      };
    },
  };
}

function run(pipeline: Pipeline, sinceDrawMs = 0) {
  const pixels = new Uint8ClampedArray(FRAME.width * FRAME.height * 4);
  return pipeline.active()
    ? pipeline.apply(pixels, FRAME, sinceDrawMs)
    : undefined;
}

test("each active pass applies once per run, in order, and an inactive one is skipped", () => {
  const log: string[] = [];
  const data: DOMStringMap = { a: "", c: "" };
  const pipeline = new Pipeline(
    [fake("a", log), fake("b", log), fake("c", log)],
    data,
  );

  run(pipeline);
  run(pipeline);

  expect(log).toEqual([
    "a#1 apply 1",
    "c#1 apply 1",
    "a#1 apply 2",
    "c#1 apply 2",
  ]);
});

test("with no pass active the pipeline is inactive", () => {
  const pipeline = new Pipeline([fake("a", [])], {});

  expect(pipeline.active()).toBe(false);
});

test("configure hands the passes the current data", () => {
  const log: string[] = [];
  const data: DOMStringMap = {};
  const pipeline = new Pipeline([fake("a", log)], data);
  expect(pipeline.active()).toBe(false);

  data.a = "";
  pipeline.configure();

  expect(pipeline.active()).toBe(true);
});

test("a pass that goes inactive and active again is rebuilt, with fresh state", () => {
  const log: string[] = [];
  const data: DOMStringMap = { a: "" };
  const pipeline = new Pipeline([fake("a", log)], data);
  run(pipeline);
  run(pipeline);

  delete data.a;
  pipeline.configure();
  run(pipeline);
  data.a = "";
  pipeline.configure();
  run(pipeline);

  expect(log).toEqual(["a#1 apply 1", "a#1 apply 2", "a#2 apply 1"]);
});

test("reset rebuilds every pass", () => {
  const log: string[] = [];
  const pipeline = new Pipeline([fake("a", log)], { a: "" });
  run(pipeline);

  pipeline.reset();
  run(pipeline);

  expect(log).toEqual(["a#1 apply 1", "a#2 apply 1"]);
});

test.each<[Pace[], Pace]>([
  [["still", "still"], "still"],
  [["still", "idle"], "idle"],
  [["idle", "still"], "idle"],
  [["still", "active"], "active"],
  [["active", "idle"], "active"],
])("passes reporting %j run at %s", (paces, merged) => {
  const data: DOMStringMap = { p0: "", p1: "" };
  const shaders = paces.map((pace, i) => fake(`p${i}`, [], pace));

  expect(run(new Pipeline(shaders, data))).toBe(merged);
});

test("a fade over a drifting pass, which never settles, holds full rate only for a second after a draw", () => {
  const data: DOMStringMap = { fade: "", drift: "" };
  const shaders = [fake("fade", [], "active"), fake("drift", [], "idle")];
  const pipeline = new Pipeline(shaders, data);

  expect(run(pipeline, 999)).toBe("active");
  expect(run(pipeline, 1000)).toBe("idle");
});

test("a pass edits the logical bitmap it is handed, reading its knob through configure", () => {
  const seen: number[][] = [];
  const twoColour: Shader = {
    attributes: ["data-two-colour"],
    create() {
      let dark = 0;
      let light = 255;
      return {
        configure(data) {
          [dark, light] = (data.twoColour ?? "0,255").split(",").map(Number);
        },
        active: () => true,
        apply(pixels, frame) {
          seen.push([pixels.length, frame.width, frame.height]);
          for (let i = 0; i < pixels.length; i += 4) {
            pixels.fill(pixels[i] < 128 ? dark : light, i, i + 3);
          }
          return "still";
        },
      };
    },
  };
  const data: DOMStringMap = {};
  const pipeline = new Pipeline([twoColour], data);
  const pixels = Uint8ClampedArray.of(100, 100, 100, 255, 200, 200, 200, 255);

  expect(pipeline.active()).toBe(true);
  pipeline.apply(pixels, FRAME, 0);
  expect(seen).toEqual([[8, 2, 1]]);
  expect([...pixels]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);

  data.twoColour = "30,200";
  pipeline.configure();
  pipeline.apply(pixels.fill(100), FRAME, 0);
  expect([...pixels.slice(0, 3)]).toEqual([30, 30, 30]);
});
