/**
 * Drives the built /play page in Playwright's headless Chromium, for
 * `scripts/perf.mjs` and `scripts/budget-check.mjs`. Each build is served
 * straight from its `dist/` at its own host, `http://<host>.localhost/`, so
 * no web server runs and no build sees another's storage.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { chromium } from "playwright";

export const VIEWPORT = { width: 1280, height: 800 };

/**
 * Launches Chromium for `builds`, `{ host: distPath }`, rendering in software
 * unless `gpu`, which fails rather than fall back. `renderer` names the GPU,
 * or is undefined in software.
 */
export async function launch(builds, { gpu = false } = {}) {
  const roots = {};
  for (const [host, path] of Object.entries(builds)) {
    roots[host] = pathToFileURL(`${resolve(path)}/`);
    if (!existsSync(new URL("play/index.html", roots[host]))) {
      throw new Error(`No /play page in ${path}: run \`pnpm build\` first.`);
    }
  }
  const browser = await chromium.launch({
    channel: "chromium",
    args: gpu ? ["--enable-gpu", "--ignore-gpu-blocklist"] : [],
  });
  const system = await browser.newBrowserCDPSession();
  const { gpu: info } = await system.send("SystemInfo.getInfo");
  const renderer =
    info.featureStatus.gpu_compositing === "enabled"
      ? info.devices[0].deviceString
      : undefined;
  if (gpu && !renderer) {
    await browser.close();
    throw new Error(
      "--gpu found no usable GPU driver, so Chromium composites in software. On NixOS, run it with `nix-shell --run`.",
    );
  }
  const context = await browser.newContext({ viewport: VIEWPORT });
  await context.route("**/*", (route) => {
    const { hostname, pathname } = new URL(route.request().url());
    const root = roots[hostname.split(".")[0]];
    const file =
      root &&
      new URL(
        `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`,
        root,
      );
    return file && existsSync(file)
      ? route.fulfill({ path: file.pathname })
      : route.fulfill({ status: 404 });
  });
  const page = await context.newPage();
  const devtools = await context.newCDPSession(page);
  await devtools.send("Performance.enable");
  return { browser, system, renderer, page, devtools };
}

/** The /play page's controls, and what they offer. */
export function playControls(page) {
  const toyOptions = page.locator("[data-toy] option:not([hidden])");
  const displayButton = page.locator("[data-display]");
  const shownDisplay = async () =>
    (await displayButton.textContent()).replace("Display: ", "");
  return {
    open: (host) => page.goto(`http://${host}.localhost/play/`),
    toys: () =>
      toyOptions.evaluateAll((all) =>
        all.map((option) => option.value).filter((id) => id !== "random"),
      ),
    /** Every display, in the order the button cycles through them, ending back on the first. */
    async displays() {
      const seen = [];
      while (!seen.includes(await shownDisplay())) {
        seen.push(await shownDisplay());
        await displayButton.click();
      }
      return seen;
    },
    hasToy: async (toy) =>
      (await toyOptions.and(page.locator(`[value="${toy}"]`)).count()) > 0,
    chooseToy: (toy) => page.selectOption("[data-toy]", toy),
    /** Presses the display button until `display` shows; false if it never does. */
    async chooseDisplay(display, displayCount) {
      for (let presses = 0; (await shownDisplay()) !== display; presses += 1) {
        if (presses === displayCount) return false;
        await displayButton.click();
      }
      return true;
    },
  };
}

/** Holds every CPU core's clock high while it runs; see the callers for why. */
export const holdClockHigh = () =>
  new Worker("for (;;);", { eval: true }).unref();

/**
 * Runs in the page, as `page.evaluate(play, { ms, press })`. Sweeps the
 * pointer down the viewport's diagonal, then, if `press`, drags it back up;
 * otherwise hovers back up. Places it by the clock, so a slow frame samples
 * the same path more coarsely. Resolves with the ms between frames.
 */
export const play = ({ ms, press = true }) =>
  new Promise((resolve) => {
    const gaps = [];
    let start;
    let last;
    let held = false;
    const point = (type, share, buttons) =>
      window.dispatchEvent(
        new PointerEvent(type, {
          clientX: share * innerWidth,
          clientY: share * innerHeight,
          pointerType: "mouse",
          pointerId: 1,
          isPrimary: true,
          buttons,
        }),
      );
    const frame = (now) => {
      start ??= now;
      if (last !== undefined) gaps.push(now - last);
      last = now;
      const share = (now - start) / ms;
      if (share >= 1) {
        if (held) point("pointerup", 0, 0);
        resolve(gaps);
        return;
      }
      if (press && share >= 0.5 && !held) {
        point("pointerdown", 1, 1);
        held = true;
      }
      const along = share < 0.5 ? share * 2 : 2 - share * 2;
      point("pointermove", along, held ? 1 : 0);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
