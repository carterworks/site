import { afterEach, expect, test } from "vitest";
import {
  backdropDefaults,
  installBackdropDefaults,
} from "../../test/backdrop-defaults";
import { KNOBS, property, readDefaults } from "./knobs";

const defaults = backdropDefaults();
const declared = new Map(defaults);
const knobs = Object.entries(KNOBS);

afterEach(() => document.head.replaceChildren());

test("every knob has exactly one default in global.css, and every default is a knob's", () => {
  const properties = knobs.map(([key]) => property(key));
  const names = defaults.map(([name]) => name);

  expect(
    properties.filter((name) => !declared.has(name)),
    "knobs with no default in global.css's :root",
  ).toEqual([]);
  expect(
    names.filter((name) => !properties.includes(name)),
    "defaults in global.css's :root with no knob in KNOBS",
  ).toEqual([]);
  expect(
    names.filter((name, index) => names.indexOf(name) !== index),
    "defaults declared more than once",
  ).toEqual([]);
});

test.for(knobs)("the default for %s is a valid value", ([key, knob]) => {
  const css = declared.get(property(key)) ?? "";
  const value = knob.parse(css);
  const { control } = knob;

  if (control.kind === "range") {
    expect(value).toBeGreaterThanOrEqual(control.min);
    expect(value).toBeLessThanOrEqual(control.max);
  } else if (control.kind === "toggle") {
    expect(["true", "false"]).toContain(css);
  } else if (control.kind === "select") {
    expect(Object.keys(control.choices)).toContain(value);
  } else {
    // The colour input accepts only this form, and shows black for any other.
    expect(value).toMatch(/^#[\da-f]{6}$/i);
  }
});

test("a toggle greys out only a range knob", () => {
  const disabled = knobs.flatMap(([, { control }]) =>
    control.kind === "toggle" && control.disables ? [control.disables] : [],
  );

  for (const key of disabled) {
    expect(KNOBS[key as keyof typeof KNOBS]?.control.kind).toBe("range");
  }
});

test("readDefaults parses every knob's default off :root", () => {
  installBackdropDefaults();

  expect(readDefaults()).toEqual(
    Object.fromEntries(
      knobs.map(([key, knob]) => [
        key,
        knob.parse(declared.get(property(key))!),
      ]),
    ),
  );
});
