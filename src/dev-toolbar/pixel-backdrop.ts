import { defineToolbarApp } from "astro/toolbar";
import {
  readDefaults,
  type PixelBackdropOptions,
} from "../components/pixel-backdrop";

/**
 * A small tweakpane for the site's `<pixel-backdrop>`. Each control reads the
 * live options off the element and writes a partial back through `configure`,
 * so changes show up on the page immediately. In dev the element persists them.
 *
 * The pane is rebuilt rather than built once: the dev toolbar resets every app
 * canvas when it reconnects (which happens on each view transition), and it
 * re-appends itself on `astro:after-swap`. Built-in apps re-render on toggle;
 * this one does the same and also rebuilds after a swap.
 */

type BackdropElement = HTMLElement & {
  options: PixelBackdropOptions;
  configure(partial: Partial<PixelBackdropOptions>): void;
  reset(): void;
};

type ToolbarToggleElement = HTMLElement & {
  input: HTMLInputElement;
  toggleStyle?: string;
};

type ToolbarSelectElement = HTMLElement & {
  element: HTMLSelectElement;
  selectStyle?: string;
};

type ToolbarButtonElement = HTMLElement & {
  buttonStyle?: string;
  size?: string;
};

type Refresher = () => void;

const backdrop = () =>
  document.querySelector<BackdropElement>("pixel-backdrop");

const current = (): PixelBackdropOptions =>
  backdrop()?.options ?? readDefaults();

let pending: Partial<PixelBackdropOptions> = {};
let updateQueued = false;

/**
 * Sliders fire many `input` events per drag; merge them and apply once a frame
 * so the canvas isn't reconfigured and repainted several times per frame.
 */
const update = (partial: Partial<PixelBackdropOptions>) => {
  pending = { ...pending, ...partial };
  if (updateQueued) return;
  updateQueued = true;
  requestAnimationFrame(() => {
    updateQueued = false;
    const next = pending;
    pending = {};
    backdrop()?.configure(next);
  });
};

function makeRow(text: string) {
  const row = document.createElement("div");
  row.className = "row";
  const label = document.createElement("label");
  label.textContent = text;
  const control = document.createElement("div");
  control.className = "control";
  const output = document.createElement("output");
  row.appendChild(label);
  row.appendChild(control);
  row.appendChild(output);
  return { row, label, control, output };
}

function addRange(
  panel: HTMLElement,
  refreshers: Refresher[],
  text: string,
  key: keyof PixelBackdropOptions,
  bounds: { min: number; max: number; step: number; suffix?: string },
) {
  const { row, label, control, output } = makeRow(text);
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(bounds.min);
  input.max = String(bounds.max);
  input.step = String(bounds.step);
  input.id = `pixel-backdrop-${key}`;
  label.htmlFor = input.id;
  control.appendChild(input);
  panel.appendChild(row);

  const render = () => {
    const value = current()[key] as number;
    input.value = String(value);
    output.textContent = `${value}${bounds.suffix ?? ""}`;
  };
  render();
  refreshers.push(render);

  input.addEventListener("input", () => {
    const value = Number(input.value);
    output.textContent = `${value}${bounds.suffix ?? ""}`;
    update({ [key]: value } as Partial<PixelBackdropOptions>);
  });

  return { row, input };
}

function addToggle(
  panel: HTMLElement,
  refreshers: Refresher[],
  text: string,
  key: keyof PixelBackdropOptions,
  onChange?: () => void,
) {
  const { row, control, output } = makeRow(text);
  output.remove();
  const toggle = document.createElement(
    "astro-dev-toolbar-toggle",
  ) as ToolbarToggleElement;
  toggle.toggleStyle = "gray";
  control.appendChild(toggle);
  panel.appendChild(row);

  const render = () => {
    toggle.input.checked = current()[key] as boolean;
  };
  render();
  refreshers.push(render);

  toggle.input.addEventListener("change", () => {
    update({ [key]: toggle.input.checked } as Partial<PixelBackdropOptions>);
    onChange?.();
  });

  return { row, toggle };
}

function addSelect(
  panel: HTMLElement,
  refreshers: Refresher[],
  text: string,
  key: keyof PixelBackdropOptions,
  choices: { value: string; label: string }[],
) {
  const { row, control, output } = makeRow(text);
  output.remove();
  const select = document.createElement(
    "astro-dev-toolbar-select",
  ) as ToolbarSelectElement;
  select.selectStyle = "gray";
  select.setAttribute("aria-label", text);
  for (const choice of choices) {
    const option = document.createElement("option");
    option.value = choice.value;
    option.textContent = choice.label;
    // Append to the native select directly: the component moves slotted
    // options into it on a later `slotchange`, so a synchronous `.value` set
    // would be lost.
    select.element.appendChild(option);
  }
  control.appendChild(select);
  panel.appendChild(row);

  const render = () => {
    select.element.value = current()[key] as string;
  };
  render();
  refreshers.push(render);

  select.element.addEventListener("change", () => {
    update({ [key]: select.element.value } as Partial<PixelBackdropOptions>);
  });
}

function addColor(
  panel: HTMLElement,
  refreshers: Refresher[],
  text: string,
  key: keyof PixelBackdropOptions,
) {
  const { row, label, control, output } = makeRow(text);
  const input = document.createElement("input");
  input.type = "color";
  input.id = `pixel-backdrop-${key}`;
  label.htmlFor = input.id;
  control.appendChild(input);
  panel.appendChild(row);

  const render = () => {
    const value = current()[key] as string;
    input.value = value;
    output.textContent = value;
  };
  render();
  refreshers.push(render);

  input.addEventListener("input", () => {
    output.textContent = input.value;
    update({ [key]: input.value } as Partial<PixelBackdropOptions>);
  });
}

/** (Re)build the pane in the app's shadow root, replacing any earlier mount. */
function renderPane(canvas: ShadowRoot) {
  canvas.querySelector("[data-pixel-backdrop-pane]")?.remove();
  canvas.querySelector("style[data-pixel-backdrop]")?.remove();

  const style = document.createElement("style");
  style.setAttribute("data-pixel-backdrop", "");
  style.textContent = `
    :host astro-dev-toolbar-window {
      max-block-size: min(70svh, 32rem);
      overflow-y: auto;
    }
    .panel {
      display: grid;
      gap: 0.6rem;
      inline-size: 21rem;
      padding: 0.35rem 0.25rem 0.1rem;
    }
    .row {
      align-items: center;
      display: grid;
      gap: 0.75rem;
      grid-template-columns: 8rem minmax(0, 1fr) 4.5rem;
    }
    .row label {
      font-size: 0.8rem;
    }
    .row output {
      font-size: 0.75rem;
      font-variant-numeric: tabular-nums;
      opacity: 0.7;
      text-align: right;
    }
    .row input[type="range"] {
      inline-size: 100%;
    }
    .row input[type="color"] {
      background: none;
      border: 0;
      block-size: 1.4rem;
      inline-size: 100%;
      padding: 0;
    }
    .heading {
      font-size: 0.7rem;
      grid-column: 1 / -1;
      letter-spacing: 0.05em;
      opacity: 0.6;
      text-transform: uppercase;
    }
    .row[data-disabled] {
      opacity: 0.4;
      pointer-events: none;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      margin-block-start: 0.5rem;
    }
  `;

  const pane = document.createElement("astro-dev-toolbar-window");
  pane.setAttribute("data-pixel-backdrop-pane", "");
  const panel = document.createElement("div");
  panel.className = "panel";
  pane.appendChild(panel);

  canvas.appendChild(style);
  canvas.appendChild(pane);

  const refreshers: Refresher[] = [];

  addToggle(panel, refreshers, "Enabled", "enabled");

  // Scale and "Fit viewport" are ordered as a pair, but the scale row is built
  // first so the toggle can disable it.
  const scale = addRange(panel, refreshers, "Scale", "scale", {
    min: 1,
    max: 64,
    step: 1,
  });
  const fit = addToggle(panel, refreshers, "Fit viewport", "autoFit");
  panel.insertBefore(fit.row, scale.row);

  const syncScale = () => {
    const on = current().autoFit;
    scale.row.toggleAttribute("data-disabled", on);
    scale.input.disabled = on;
  };
  syncScale();
  refreshers.push(syncScale);
  fit.toggle.input.addEventListener("change", syncScale);

  addRange(panel, refreshers, "Gap", "gap", { min: 0, max: 8, step: 1 });
  addSelect(panel, refreshers, "Shape", "shape", [
    { value: "square", label: "Square" },
    { value: "circle", label: "Circle" },
  ]);
  addRange(panel, refreshers, "Ghost", "ghost", {
    min: 0,
    max: 98,
    step: 1,
    suffix: "%",
  });
  addRange(panel, refreshers, "Trail", "trail", {
    min: 0,
    max: 1000,
    step: 10,
    suffix: "ms",
  });
  addRange(panel, refreshers, "Ripple size", "rippleSize", {
    min: 1,
    max: 60,
    step: 1,
  });
  addRange(panel, refreshers, "Ripple speed", "rippleSpeed", {
    min: 100,
    max: 2000,
    step: 50,
    suffix: "ms",
  });
  addRange(panel, refreshers, "Panel opacity", "panelOpacity", {
    min: 0,
    max: 100,
    step: 1,
    suffix: "%",
  });
  addRange(panel, refreshers, "Panel blur", "panelBlur", {
    min: 0,
    max: 40,
    step: 1,
    suffix: "px",
  });

  const noise = document.createElement("div");
  noise.className = "heading";
  noise.textContent = "Background noise";
  panel.appendChild(noise);

  addRange(panel, refreshers, "Intensity", "noise", {
    min: 0,
    max: 100,
    step: 1,
    suffix: "%",
  });
  addRange(panel, refreshers, "Feature size", "noiseScale", {
    min: 1,
    max: 40,
    step: 1,
  });
  addRange(panel, refreshers, "Drift speed", "noiseSpeed", {
    min: 0,
    max: 100,
    step: 1,
  });

  const colors = document.createElement("div");
  colors.className = "heading";
  colors.textContent = "Pixel colours";
  panel.appendChild(colors);

  addColor(panel, refreshers, "Pixel (light)", "lightBase");
  addColor(panel, refreshers, "Ink (light)", "lightInk");
  addColor(panel, refreshers, "Pixel (dark)", "darkBase");
  addColor(panel, refreshers, "Ink (dark)", "darkInk");

  const actions = document.createElement("div");
  actions.className = "actions";
  const reset = document.createElement(
    "astro-dev-toolbar-button",
  ) as ToolbarButtonElement;
  reset.buttonStyle = "gray";
  reset.size = "small";
  reset.textContent = "Reset";
  reset.addEventListener("click", () => {
    backdrop()?.reset();
    for (const refresh of refreshers) refresh();
  });
  actions.appendChild(reset);
  panel.appendChild(actions);
}

export default defineToolbarApp({
  init(canvas, app) {
    renderPane(canvas);

    // The toolbar re-appends itself on every view transition, which resets each
    // app canvas. Rebuild after the swap, and whenever the app is switched on.
    document.addEventListener("astro:after-swap", () => renderPane(canvas));
    app.onToggled(({ state }) => {
      if (state) renderPane(canvas);
    });
  },
});
