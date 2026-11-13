import { RANDOM } from "../settings/backdrop-toy-setting";
import { TOYS } from "../backdrop-toys";
import {
  DISPLAYS,
  type DisplayLook,
} from "../pixel-backdrop/backdrop-displays";
import { imageToy } from "../backdrop-toys/image";
import { onePercentLow } from "./frame-rate";
import { settings } from "../settings/site-settings";

const option = (label: string, value: string) =>
  Object.assign(document.createElement("option"), {
    textContent: label,
    value,
  });

type Shape = NonNullable<DisplayLook["shape"]>;

/** The canvas's shapes, default first; a test holds it to the canvas's own list. */
const SHAPES: Shape[] = [
  "square",
  "circle",
  "ring",
  "diamond",
  "hex",
  "triangle",
  "dash",
  "slash",
  "cross",
];

const FIT = "fit";
const CELL_SIZES = [5, 7, 10, 14];

const capitalized = (word: string) => word[0].toUpperCase() + word.slice(1);

const SAMPLE_MS = 500;
const HISTORY_MS = 30_000;
const SLOTS = HISTORY_MS / SAMPLE_MS;

/** U+2007 is a figure space, as wide as a tabular digit. */
const pad = (rate: number) => String(Math.round(rate)).padStart(3, " ");

/**
 * Shows the frame rate each half second, with the 1% low and a sparkline of
 * the last 30s. Returns a function that stops it.
 */
const meterFrames = (meter: HTMLElement) => {
  const rate = meter.querySelector("[data-fps-rate]");
  const low = meter.querySelector("[data-fps-low]");
  const history = meter.querySelector("[data-fps-history]");
  if (!rate || !low || !history) return () => {};

  const recent: { at: number; ms: number }[] = [];
  const rates: number[] = [];
  let counted = 0;
  let since: number | undefined;
  let last: number | undefined;

  const show = (now: number, elapsed: number) => {
    while (recent[0] && recent[0].at <= now - HISTORY_MS) recent.shift();
    rates.push((counted * 1000) / elapsed);
    if (rates.length > SLOTS) rates.shift();

    const slowest = onePercentLow(recent.map(({ ms }) => ms));
    const peak = Math.max(...rates);

    rate.textContent = `FPS: ${pad(rates.at(-1) ?? 0)}`;
    low.textContent = `1% low: ${pad(slowest)}`;
    history.setAttribute(
      "points",
      rates
        .flatMap((value, index) => {
          const x = SLOTS - rates.length + index;
          const y = (peak - value) / peak;
          return [`${x},${y}`, `${x + 1},${y}`];
        })
        .join(" "),
    );
    meter.hidden = false;
  };

  let frame = 0;
  const count = (now: number) => {
    if (last !== undefined && now > last) {
      recent.push({ at: now, ms: now - last });
      counted += 1;
    }
    last = now;
    since ??= now;
    if (now - since >= SAMPLE_MS) {
      show(now, now - since);
      counted = 0;
      since = now;
    }
    frame = requestAnimationFrame(count);
  };
  frame = requestAnimationFrame(count);
  return () => cancelAnimationFrame(frame);
};

class PlayToolbarElement extends HTMLElement {
  cleanup?: () => void;

  disconnectedCallback() {
    this.cleanup?.();
  }

  connectedCallback() {
    const toy = this.querySelector<HTMLSelectElement>("[data-toy]");
    const theme = this.querySelector<HTMLButtonElement>("[data-theme]");
    const display = this.querySelector<HTMLSelectElement>("[data-display]");
    const shape = this.querySelector<HTMLSelectElement>("[data-shape]");
    const shapeNote = this.querySelector<HTMLElement>("[data-shape-note]");
    const cells = this.querySelector<HTMLSelectElement>("[data-cells]");
    const pick = this.querySelector<HTMLButtonElement>("[data-image]");
    const input = this.querySelector<HTMLInputElement>("input[type=file]");
    const status = this.querySelector<HTMLElement>("[data-status]");
    const fps = this.querySelector<HTMLElement>("[data-fps]");
    if (
      !toy ||
      !theme ||
      !display ||
      !shape ||
      !shapeNote ||
      !cells ||
      !pick ||
      !input ||
      !status ||
      !fps
    ) {
      return;
    }

    toy.replaceChildren(
      ...[...TOYS, { id: RANDOM, label: "Random" }].map(({ id, label }) =>
        option(label, id),
      ),
      Object.assign(option("Image", "image"), { hidden: true }),
    );
    display.replaceChildren(
      ...DISPLAYS.map(({ id, label }) => option(label, id)),
    );
    shape.replaceChildren(...SHAPES.map((id) => option(capitalized(id), id)));
    cells.replaceChildren(
      option("Fit", FIT),
      ...CELL_SIZES.map((size) => option(`${size}px`, String(size))),
    );

    let playing: ImageBitmap | undefined;
    let request = 0;
    let chosenShape: Shape | undefined;

    const backdrop = () => document.querySelector("pixel-backdrop");
    const shownDisplay = () =>
      DISPLAYS.find(({ id }) => id === settings.display.value())!;

    // A tweak outranks a display's look, so a display that draws its own
    // shape is handed it back as one, and the chosen shape returns after.
    const applyShape = () => {
      if (chosenShape === undefined) return;
      backdrop()?.configure({
        shape: shownDisplay().look?.shape ?? chosenShape,
      });
    };

    const render = () => {
      toy.value =
        backdrop()?.toy === "image" ? "image" : settings.backdrop.value();
      theme.textContent = `Theme: ${settings.theme.label()}`;
      theme.setAttribute(
        "aria-label",
        `${theme.textContent}. Activate to change.`,
      );
      display.value = settings.display.value();
      const { label, look } = shownDisplay();
      const knobs = backdrop()?.knobs;
      shape.disabled = look?.shape !== undefined;
      shape.value = look?.shape ?? knobs?.shape ?? SHAPES[0];
      shapeNote.textContent = shape.disabled ? `${label} sets the shape.` : "";
      cells.value = knobs?.autoFit === false ? String(knobs.scale) : FIT;
    };

    const release = () => {
      playing?.close();
      playing = undefined;
    };

    toy.addEventListener("change", () => {
      request += 1;
      status.textContent = "";
      settings.backdrop.choose(toy.value);
      release();
      render();
    });
    theme.addEventListener("click", () => {
      settings.theme.cycle();
      render();
    });
    display.addEventListener("change", () => {
      settings.display.choose(display.value);
      applyShape();
      render();
    });
    shape.addEventListener("change", () => {
      chosenShape = shape.value as Shape;
      applyShape();
      render();
    });
    cells.addEventListener("change", () => {
      backdrop()?.configure(
        cells.value === FIT
          ? { autoFit: true }
          : { autoFit: false, scale: Number(cells.value) },
      );
      render();
    });
    pick.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      request += 1;
      const current = request;
      status.textContent = "";
      const decoded = await createImageBitmap(file).catch(() => undefined);
      if (current !== request || !this.isConnected) {
        decoded?.close();
        return;
      }
      if (!decoded) {
        status.textContent = "Couldn't open that image.";
        return;
      }
      backdrop()?.play(imageToy(decoded));
      release();
      playing = decoded;
      render();
    });

    const stopMeter = meterFrames(fps);

    // The label alone follows the OS; storage is never touched by it. The
    // toy is chosen on page load, after this connects.
    const osScheme = matchMedia("(prefers-color-scheme: dark)");
    osScheme.addEventListener("change", render);
    document.addEventListener("astro:page-load", render);
    this.cleanup = () => {
      stopMeter();
      osScheme.removeEventListener("change", render);
      document.removeEventListener("astro:page-load", render);
      // The backdrop keeps redrawing the picture on resize until the next
      // page's load swaps its toy in, and a closed bitmap would throw there.
      const held = playing;
      if (held) {
        document.addEventListener("astro:page-load", () => held.close(), {
          once: true,
        });
      }
    };

    render();
  }
}

if (!customElements.get("play-toolbar")) {
  customElements.define("play-toolbar", PlayToolbarElement);
}
