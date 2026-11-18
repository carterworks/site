import { expect, test, vi } from "vitest";
import "@carterworks/pixel-backdrop/emulated-canvas";
import { countAllocations } from "./toy-canvas";

test("counts what the backdrop allocates, though it is installed as a dependency", () => {
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext() {
        return {};
      }
    },
  );
  const canvas = document.createElement("emulated-canvas");

  const allocations = countAllocations();
  try {
    canvas.getContext("2d");
  } finally {
    allocations.restore();
    vi.unstubAllGlobals();
  }

  expect(allocations.count()).toBe(1);
});
