import { RANDOM } from "./backdrop-mode-setting";
import { MODES } from "./backdrop-modes";
import { imageToy } from "./backdrop-modes/image";
import { settings } from "./site-settings";

const option = (label: string, value: string) =>
  Object.assign(document.createElement("option"), {
    textContent: label,
    value,
  });

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

    let frames = 0;
    let since: number | undefined;
    let frame = 0;
    const count = (now: number) => {
      since ??= now;
      if (now > since) frames += 1;
      if (now - since >= 500) {
        fps.textContent = `${Math.round((frames * 1000) / (now - since))} fps`;
        frames = 0;
        since = now;
      }
      frame = requestAnimationFrame(count);
    };
    frame = requestAnimationFrame(count);

    // The label alone follows the OS; storage is never touched by it. The
    // toy is chosen on page load, after this connects.
    const osScheme = matchMedia("(prefers-color-scheme: dark)");
    osScheme.addEventListener("change", render);
    document.addEventListener("astro:page-load", render);
    this.cleanup = () => {
      cancelAnimationFrame(frame);
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
