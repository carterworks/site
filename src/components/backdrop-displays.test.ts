import { beforeEach, expect, test, vi } from "vitest";
import { DISPLAY_KEY, DISPLAYS, storedDisplay } from "./backdrop-displays";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

test("Site comes first and has no look, followed by the two screens", () => {
  expect(DISPLAYS.map(({ id, label }) => [id, label])).toEqual([
    ["site", "Site"],
    ["pocket-lcd", "Pocket LCD"],
    ["amber-lcd", "Amber LCD"],
  ]);
  expect(DISPLAYS[0].look).toBeUndefined();
});

test.each(DISPLAYS.filter(({ look }) => look))(
  "$label's colours are hex, since any other form needs a helper canvas to parse",
  ({ look }) => {
    for (const colour of [look!.base, look!.ink]) {
      expect(colour).toMatch(/^#[0-9a-f]{6}$/);
    }
  },
);
