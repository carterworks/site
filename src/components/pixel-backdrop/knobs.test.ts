import { afterEach, expect, test } from "vitest";
import {
  backdropDeclarations,
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

test("no stylesheet declares a --backdrop-* property but the knob defaults", () => {
  const knobDefaults = defaults.map(
    ([name]) => `src/layouts/global.css: ${name}`,
  );
  const strays = backdropDeclarations().filter(
    (declaration, index, all) =>
      !knobDefaults.includes(declaration) || all.indexOf(declaration) !== index,
  );

  expect(
    strays,
    "declared besides the knob defaults in global.css's :root; the element sets --backdrop-display-* itself",
  ).toEqual([]);
});

test("readDefaults parses every knob's default off :root", () => {
  installBackdropDefaults();

  expect(readDefaults()).toEqual(
    Object.fromEntries(
      knobs.map(([key, parse]) => [key, parse(declared.get(property(key))!)]),
    ),
  );
});
