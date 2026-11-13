import { expect, test } from "vitest";
import { DISPLAYS } from "./backdrop-displays";
import { MAX_GHOST } from "../emulated-canvas/limits";

const looks = DISPLAYS.filter(({ look }) => look);

test("the site's own look comes first and has no look", () => {
  expect(DISPLAYS[0].look).toBeUndefined();
});

test("ids are unique", () => {
  const ids = DISPLAYS.map(({ id }) => id);
  expect(new Set(ids).size).toBe(ids.length);
});

test.each(looks)(
  "$label's colours are hex, since any other form needs a helper canvas to parse",
  ({ look }) => {
    for (const colour of [
      look!.base,
      look!.ink,
      look!.vignette?.edge ?? "#000000",
    ]) {
      expect(colour).toMatch(/^#[0-9a-f]{6}$/);
    }
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
