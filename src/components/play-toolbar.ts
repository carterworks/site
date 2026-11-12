import { RANDOM } from "./backdrop-mode-setting";
import { MODES } from "./backdrop-modes";
import { imageToy } from "./backdrop-modes/image";
import { settings } from "./site-settings";

const option = (label: string, value: string) =>
  Object.assign(document.createElement("option"), {
    textContent: label,
    value,
  });

const SAMPLE_MS = 500;
const HISTORY_MS = 30_000;
const SLOTS = HISTORY_MS / SAMPLE_MS;

const pad = (rate: number) => String(Math.round(rate)).padStart(3, "0");

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

    const slowest = recent
      .map(({ ms }) => ms)
      .sort((a, b) => b - a)
      .slice(0, Math.ceil(recent.length / 100));
    const slowestTotal = slowest.reduce((sum, ms) => sum + ms, 0);
    const peak = Math.max(...rates);

    rate.textContent = `FPS: ${pad(rates.at(-1) ?? 0)}`;
    low.textContent = `1% low: ${pad((slowest.length * 1000) / slowestTotal)}`;
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
    const display = this.querySelector<HTMLButtonElement>("[data-display]");
    const pick = this.querySelector<HTMLButtonElement>("[data-image]");
    const input = this.querySelector<HTMLInputElement>("input[type=file]");
    const status = this.querySelector<HTMLElement>("[data-status]");
    const fps = this.querySelector<HTMLElement>("[data-fps]");
    if (!toy || !theme || !display || !pick || !input || !status || !fps) {
      return;
    }

    toy.replaceChildren(
      ...[...MODES, { id: RANDOM, label: "Random" }].map(({ id, label }) =>
        option(label, id),
      ),
      Object.assign(option("Image", "image"), { hidden: true }),
    );

    let playing: ImageBitmap | undefined;
    let request = 0;

    const backdrop = () => document.querySelector("pixel-backdrop");

    const describe = (
      button: HTMLButtonElement,
      title: string,
      value: string,
    ) => {
      button.textContent = `${title}: ${value}`;
      button.setAttribute(
        "aria-label",
        `${button.textContent}. Activate to change.`,
      );
    };

    const render = () => {
      toy.value =
        backdrop()?.mode === "image" ? "image" : settings.backdrop.value();
      describe(theme, "Theme", settings.theme.label());
      describe(display, "Display", settings.display.label());
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
    display.addEventListener("click", () => {
      settings.display.cycle();
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
