import { vi } from "vitest";
import type { BackdropKnobs } from "../components/pixel-backdrop/knobs";
import { place } from "./toy-canvas";

/**
 * Stubs `matchMedia` with a reduced-motion query a test can flip. Import this
 * module before `pixel-backdrop`, which reads its media queries as it loads.
 */
export const motion = (() => {
  const listeners = new Set<() => void>();
  const query = {
    matches: false,
    addEventListener: (_: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", (media: string) =>
    media.includes("reduced-motion")
      ? query
      : { matches: false, addEventListener() {}, removeEventListener() {} },
  );
  return {
    set(reduced: boolean) {
      query.matches = reduced;
      for (const listener of listeners) listener();
    },
  };
})();

export const SIZE = 160;

/** A 4:3 viewport over the square grid, which overhangs it top and bottom. */
export function mount(
  id: string,
  knobs: Partial<BackdropKnobs> = {},
  display = "site",
) {
  const backdrop = document.createElement("pixel-backdrop");
  backdrop.setToy(id);
  backdrop.setDisplay(display);
  backdrop.configure(knobs);
  const canvas = document.createElement("emulated-canvas");
  Object.assign(canvas.dataset, {
    width: String(SIZE),
    height: String(SIZE),
    fit: "viewport",
  });
  place(
    canvas,
    new DOMRect(0, (innerHeight - innerWidth) / 2, innerWidth, innerWidth),
  );
  backdrop.append(canvas);
  document.body.append(backdrop);
  return canvas;
}

/**
 * Mounts as `mount` does, also returning the canvas's closed shadow root,
 * caught as it is attached because nothing can reach it afterwards.
 */
export function mountWithShadow(...args: Parameters<typeof mount>) {
  const attachShadow = vi.spyOn(Element.prototype, "attachShadow");
  const canvas = mount(...args);
  const shadow: ShadowRoot = attachShadow.mock.results.at(-1)!.value;
  return { canvas, shadow };
}

export const pointer = (
  type: string,
  share: number,
  init: PointerEventInit = {},
) =>
  window.dispatchEvent(
    new PointerEvent(type, {
      clientX: share * innerWidth,
      clientY: share * innerHeight,
      pointerType: "mouse",
      pointerId: 1,
      isPrimary: true,
      ...init,
    }),
  );

/**
 * About 3 s of input: a hover sweep down the viewport's diagonal, a
 * press-and-hold dragged back up it, a tap in the middle, then the pointer
 * leaves. `advance` moves the fake clock on by the given ms.
 */
export async function play(
  advance: (ms: number) => Promise<unknown> = (ms) =>
    vi.advanceTimersByTimeAsync(ms),
) {
  for (let ms = 0; ms < 1000; ms += 16) {
    pointer("pointermove", ms / 1000);
    await advance(16);
  }
  pointer("pointerdown", 1, { buttons: 1 });
  for (let ms = 0; ms < 1000; ms += 16) {
    pointer("pointermove", 1 - ms / 1000, { buttons: 1 });
    await advance(16);
  }
  pointer("pointerup", 0);
  await advance(250);
  pointer("pointerdown", 0.5, { buttons: 1 });
  await advance(50);
  pointer("pointerup", 0.5);
  document.dispatchEvent(new MouseEvent("mouseleave"));
  await advance(700);
}
