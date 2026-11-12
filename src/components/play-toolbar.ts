import { imageToy } from "./backdrop-modes/image";
import { settings } from "./site-settings";

class PlayToolbarElement extends HTMLElement {
  cleanup?: () => void;

  disconnectedCallback() {
    this.cleanup?.();
  }

  connectedCallback() {
    const toy = this.querySelector<HTMLButtonElement>("[data-toy]");
    const theme = this.querySelector<HTMLButtonElement>("[data-theme]");
    const pick = this.querySelector<HTMLButtonElement>("[data-image]");
    const input = this.querySelector<HTMLInputElement>("input[type=file]");
    const status = this.querySelector<HTMLElement>("[data-status]");
    if (!toy || !theme || !pick || !input || !status) return;

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
      const picture = backdrop()?.mode === "image";
      describe(toy, "Toy", picture ? "Image" : settings.backdrop.label());
      describe(theme, "Theme", settings.theme.label());
    };

    const release = () => {
      playing?.close();
      playing = undefined;
    };

    toy.addEventListener("click", () => {
      request += 1;
      status.textContent = "";
      settings.backdrop.cycle();
      release();
      render();
    });
    theme.addEventListener("click", () => {
      settings.theme.cycle();
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

    // The label alone follows the OS; storage is never touched by it. The
    // toy is chosen on page load, after this connects.
    const osScheme = matchMedia("(prefers-color-scheme: dark)");
    osScheme.addEventListener("change", render);
    document.addEventListener("astro:page-load", render);
    this.cleanup = () => {
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
