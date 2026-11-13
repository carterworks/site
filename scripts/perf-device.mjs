/**
 * Measures the built /play page on a real device. It serves `dist` as built,
 * with a probe written into /play/ only for `/play/?probe`, publishes it over
 * HTTPS on this machine's Tailscale name, and prints the address to open on
 * the device. The probe runs by itself there and posts each step back; this
 * prints them as they arrive, then a summary, and exits after one complete run.
 *
 *   pnpm perf:device [--toy fireflies] [--display pocket] [--seconds 8]
 *                    [--https 8443 | --http 192.168.1.20:8080] [--minutes 30]
 *                    [--stay] [--json results.json] [--dist dist]
 *   pnpm perf:device:test
 *
 * `--toy` and `--display` match names as `pnpm perf` does, and the matrix of
 * every match is measured; `--toy ""` takes every toy. Each step settles,
 * then measures for `--seconds` while the pointer `pnpm perf` uses plays with
 * the toy:
 *   environment   the device, whether the page is a secure context, the
 *                 timer, the frame interval idle, and whether its JavaScript
 *                 runs compiled: tight loops' cost per iteration, cold and
 *                 warm, over a native scan's per element, which a JIT does
 *                 not change
 *   idle          the backdrop off, at the start and the end
 *   as shipped    each display with each toy, and the first again at the end,
 *                 so thermal drift shows
 *   ... off       the first display with its noise, ghost or palette pass off
 *                 through the backdrop's own `configure`; `saves` is the
 *                 script time that saves against as shipped, the pass's cost
 * Per step: fps and its 1% low as the /play meter shows them; `script`, ms of
 * script per frame, the canvas's present included; `presents` per frame; and
 * `ticks`, the frame gaps in idle frame intervals to the nearest half. A step
 * that did not change what it claims is "not applied", one during which the
 * page was hidden or the toy stopped drawing is "invalid", and one that left
 * the page other than it found it is "not restored". `--stay` serves more
 * runs until `--minutes` is up, and `--json` saves every run's results,
 * frame gaps included.
 *
 * Tailscale serves the page for exactly as long as this runs, however it
 * ends, and refuses a port it already serves. `--http`
 * serves plain HTTP on that host instead, for a network without Tailscale,
 * but an insecure page may run its JavaScript without a JIT: Safari on an
 * iPhone ran the shader passes 15 times slower over plain HTTP.
 *
 * `--self-test` runs it all over loopback in headless Chromium, with short
 * steps, and exits non-zero unless every step was applied, valid and
 * restored, which is how CI notices the page's knobs or methods moving.
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { onePercentLow } from "../src/components/frame-rate.ts";
import { probe } from "./device-probe.mjs";
import { play } from "./play-page.mjs";

const { values: options } = parseArgs({
  options: {
    toy: { type: "string", default: "fireflies" },
    display: { type: "string" },
    seconds: { type: "string" },
    https: { type: "string", default: "8443" },
    http: { type: "string" },
    minutes: { type: "string" },
    stay: { type: "boolean" },
    json: { type: "string" },
    dist: { type: "string", default: "dist" },
    "self-test": { type: "boolean" },
  },
});

const selfTest = options["self-test"];
const seconds = Number(options.seconds ?? (selfTest ? 0.5 : 8));
const minutes = Number(options.minutes ?? (selfTest ? 2 : 30));
const root = resolve(options.dist);
const PLAY = join(root, "play", "index.html");
const PROBE = `<script>(${probe})(${JSON.stringify({ seconds, toy: options.toy, display: options.display })}, ${onePercentLow}, ${play});</script>`;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
};
// Warm, in headless Chromium on an i7-8700K with and without --jitless, and in
// Safari on an iPhone over HTTPS and plain HTTP, which ran no native scan.
const REFERENCE =
  "compiled 0.7–4.6 ns and 1.7–5.7 scans in desktop Chromium, 0.6–0.7 ns on an iPhone; interpreted 51–93 ns and 64–117 scans, 24–74 ns";

const round = (value) => Math.round(value * 100) / 100;
const runs = [];
const listeners = new Set();
/** The next result `wanted` accepts. */
const arrival = (wanted) =>
  new Promise((resolve) => {
    const listener = (result) => {
      if (!wanted(result)) return;
      listeners.delete(listener);
      resolve(result);
    };
    listeners.add(listener);
  });

const server = createServer((request, response) =>
  respond(request, response).catch((error) => {
    console.error(`${request.method} ${request.url}: ${error.message}`);
    if (!response.headersSent) response.writeHead(400);
    response.end();
  }),
);

async function respond(request, response) {
  const url = new URL(request.url, "http://probe");
  if (request.method === "POST" && url.pathname === "/probe-result") {
    let body = "";
    for await (const chunk of request) body += chunk;
    response.writeHead(204).end();
    report(JSON.parse(body));
    return;
  }
  const path = join(root, decodeURIComponent(url.pathname));
  if (path !== root && !path.startsWith(root + sep)) {
    return response.writeHead(403).end();
  }
  const file = url.pathname.endsWith("/") ? join(path, "index.html") : path;
  let body;
  try {
    body = await readFile(file);
  } catch {
    const directory = await readFile(join(path, "index.html")).then(
      () => true,
      () => false,
    );
    return directory
      ? response
          .writeHead(301, { Location: `${url.pathname}/${url.search}` })
          .end()
      : response.writeHead(404).end();
  }
  if (file === PLAY && url.searchParams.has("probe")) {
    body = String(body).replace(/<head[^>]*>/, (head) => head + PROBE);
  }
  response.writeHead(200, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  response.end(request.method === "HEAD" ? undefined : body);
}

const rowOf = (step) => ({
  step: step.name,
  toy: step.toy ?? "",
  display: step.display ?? "",
  fps: round(step.fps),
  low: round(step.low),
  script: round(step.script),
  saves: step.saves === undefined ? "" : round(step.saves),
  presents: round(step.presents),
  ticks: Object.entries(step.ticks)
    .sort(([a], [b]) => a - b)
    .map(([ticks, count]) => `${ticks}${ticks === "4" ? "+" : ""}×${count}`)
    .join(" "),
  result: step.problems.join("; ") || "ok",
});
const warnings = (env) => [
  ...(env.secure
    ? []
    : [
        "WARNING: the page is not a secure context. Browsers may run JavaScript without a JIT on insecure pages, so these numbers do not reflect the real site. Serve it over HTTPS, as this does by default.",
      ]),
  ...(env.compiled
    ? []
    : [
        `WARNING: the device's JavaScript looks interpreted: its loops cost ${round(env.slowdown)} times a native scan, where compiled ones cost a few. These numbers do not reflect the real site.`,
      ]),
];
const loops = (env, when) =>
  Object.entries(env.loops)
    .map(([name, times]) => `${name} ${round(times[when])}`)
    .join(", ");

function report(result) {
  if (result.type === "env") {
    console.log(`\nRun ${result.run} on ${result.userAgent}`);
    console.log(
      `Pixel ratio ${result.devicePixelRatio}, viewport ${result.viewport}, frame interval ${round(result.frameMs)} ms idle, timer resolution ${round(result.timerMs)} ms.`,
    );
    console.log(
      `Secure context: ${result.secure ? "yes" : "NO"}; screen wake lock ${result.wakeLock}.`,
    );
    console.log(
      `JavaScript ${result.compiled ? "compiled" : "INTERPRETED"}: ns per loop iteration warm ${loops(result, "warm")}, first 5 ms ${loops(result, "cold")}; ${round(result.slowdown)} times a native scan's ${round(result.scanNs)} ns per element (for reference, ${REFERENCE}).`,
    );
    for (const warning of warnings(result)) console.log(warning);
  } else if (result.type === "step") {
    const row = rowOf(result);
    console.log(
      `${result.index}/${result.total} ${[row.step, row.display, row.toy].filter(Boolean).join(", ")}: ${row.fps} fps, low ${row.low}, script ${row.script} ms${row.saves === "" ? "" : ` (saves ${row.saves})`}, ${row.presents} presents, ticks ${row.ticks}: ${row.result}`,
    );
  } else if (result.type === "done") {
    const { env, steps } = result;
    console.table(steps.map(rowOf));
    console.log(
      `Device: ${env.userAgent}. Secure context: ${env.secure ? "yes" : "NO"}. JavaScript ${env.compiled ? "compiled" : "INTERPRETED"}.`,
    );
    for (const step of steps.filter(({ kind }) => kind === "shipped")) {
      const row = rowOf(step);
      console.log(
        `${row.step}, ${row.display}, ${row.toy}: ${row.fps} fps, low ${row.low}, script ${row.script} ms a frame.`,
      );
    }
    for (const warning of warnings(env)) console.log(warning);
    runs.push(result);
    if (options.json) {
      writeFileSync(options.json, JSON.stringify(runs, null, 2));
      console.log(`Saved ${runs.length} run(s) to ${options.json}.`);
    }
  } else if (result.type === "error") {
    console.error(
      `Run ${result.run} failed: ${result.stack ?? result.message}`,
    );
  }
  for (const listener of listeners) listener(result);
}

/**
 * Publishes `target` on this machine's Tailscale name until this process
 * ends. A foreground `tailscale serve` holds its entry only while it runs,
 * and tailscaled refuses a port any entry holds. Killing this process alone,
 * even by SIGKILL, would leave it running as an orphan, so the shell around it
 * stops it when this process's end closes the shell's stdin.
 */
const publish = (port, target) =>
  new Promise((resolve) => {
    const serve = spawn(
      "sh",
      [
        "-c",
        'exec 3<&0; tailscale serve --https="$1" "$2" & t=$!; { read line <&3; kill $t; } & wait $t',
        "sh",
        port,
        target,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let errors = "";
    serve.stderr.on("data", (chunk) => (errors += chunk));
    serve.stdout.on("data", (chunk) => {
      const url = /https:\/\/[^\s/]+/.exec(chunk)?.[0];
      if (url) resolve(url);
    });
    serve.on("exit", () => {
      console.error(
        `tailscale serve --https=${port} ended, so the page is no longer published: ${errors.trim()}`,
      );
      process.exit(1);
    });
  });

const listen = (host, port) =>
  new Promise((resolve) =>
    server.listen(port, host, () => resolve(server.address().port)),
  );

let origin;
if (selfTest) {
  origin = `http://127.0.0.1:${await listen("127.0.0.1", 0)}`;
} else if (options.http) {
  const { hostname, port } = new URL(`http://${options.http}`);
  await listen(hostname.replace(/^\[|\]$/g, ""), Number(port || 80));
  origin = `http://${hostname}${port ? `:${port}` : ""}`;
  console.log(
    "WARNING: serving plain HTTP. Browsers may run JavaScript without a JIT on an insecure page, so these numbers will not reflect the real site; prefer HTTPS through Tailscale, the default.",
  );
} else {
  const port = await listen("127.0.0.1", 0);
  origin = await publish(options.https, `http://127.0.0.1:${port}`);
}
console.log(
  `Serving ${options.dist} for ${minutes} min. Open ${origin}/play/?probe on the device.`,
);
setTimeout(() => {
  console.error(
    `Stopping after ${minutes} min, with ${runs.length} complete run(s).`,
  );
  process.exit(runs.length > 0 ? 0 : 1);
}, minutes * 60_000).unref();

if (selfTest) process.exit((await runSelfTest(origin)) ? 0 : 1);
if (!options.stay) {
  await arrival(({ type }) => type === "done");
  process.exit(0);
}

/** Plays the device in headless Chromium; true if the run was complete and clean. */
async function runSelfTest(origin) {
  const problems = [];
  const expect = (ok, problem) => ok || problems.push(problem);
  for (const path of ["/", "/play/"]) {
    const response = await fetch(origin + path);
    const body = Buffer.from(await response.arrayBuffer());
    expect(
      body.equals(await readFile(join(root, path, "index.html"))),
      `${path} is not served as built`,
    );
    expect(
      response.headers.get("cache-control") === "no-store",
      `${path} is cached`,
    );
  }
  const injected = await (await fetch(`${origin}/play/?probe`)).text();
  expect(
    /^<!DOCTYPE html><html[^>]*>\s*<head[^>]*><script>/.test(injected) &&
      injected.replace(PROBE, "") === String(await readFile(PLAY)),
    "/play/?probe does not open its <head> with the probe",
  );

  const browser = await chromium.launch({ channel: "chromium" });
  /** A run in a fresh context, after `before` has used the page as a visitor might. */
  const runIn = async (before) => {
    const page = await (await browser.newContext()).newPage();
    const failed = new Promise((resolve) =>
      page.on("pageerror", (error) =>
        resolve({ type: "error", message: `page error: ${error}` }),
      ),
    );
    await before?.(page);
    const ended = arrival(({ type }) => type === "done" || type === "error");
    await page.goto(`${origin}/play/?probe`);
    const result = await Promise.race([ended, failed]);
    await page.context().close();
    return result;
  };
  const check = (name, result) => {
    if (result.type !== "done") {
      problems.push(`${name}: no complete run: ${result.message}`);
      return;
    }
    expect(
      result.steps.length === result.steps[0]?.total,
      `${name}: steps are missing`,
    );
    for (const step of result.steps) {
      for (const problem of step.problems) {
        const what = [step.name, step.display, step.toy].filter(Boolean);
        problems.push(`${name}: ${what.join(", ")}: ${problem}`);
      }
    }
  };
  check("from the first display", await runIn());
  // A device that has chosen another display starts every step from it.
  check(
    "from the second display",
    await runIn(async (page) => {
      await page.goto(`${origin}/play/`);
      await page.click("[data-display]");
    }),
  );
  await browser.close();

  for (const problem of problems) console.error(`Self-test: ${problem}`);
  console.log(
    problems.length === 0
      ? "Self-test passed: every step applied, valid and restored."
      : `Self-test failed with ${problems.length} problem(s).`,
  );
  return problems.length === 0;
}
