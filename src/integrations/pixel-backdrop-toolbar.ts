import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";

/**
 * Adds a dev-toolbar app for tweaking the site's `<pixel-backdrop>` while the
 * dev server runs. It is dev-only: `addDevToolbarApp` is skipped for every
 * other command, and the app never reaches a production build.
 */
export default function pixelBackdropToolbar(): AstroIntegration {
  return {
    name: "pixel-backdrop-toolbar",
    hooks: {
      "astro:config:setup": ({ command, addDevToolbarApp }) => {
        if (command !== "dev") return;
        addDevToolbarApp({
          id: "pixel-backdrop",
          name: "Pixel Backdrop",
          icon: "grid",
          entrypoint: fileURLToPath(
            new URL("../dev-toolbar/pixel-backdrop.ts", import.meta.url),
          ),
        });
      },
    },
  };
}
