import { defineToolbarApp } from "astro/toolbar";
import { TOYS } from "../components/backdrop-toys";
import {
  KNOBS,
  readDefaults,
  type BackdropKnobs,
  type Control,
} from "../components/pixel-backdrop/knobs";

/**
 * A small tweakpane for the site's `<pixel-backdrop>`. Each control reads the
 * live options off the element and writes a partial back through `configure`,
 * so changes show up on the page immediately. The app also persists them to
 * localStorage and restores them once, when the toolbar first starts.
 *
 * The pane is rebuilt rather than built once: the dev toolbar resets every app
 * canvas when it reconnects (which happens on each view transition), and it
 * re-appends itself on `astro:after-swap`. Built-in apps re-render on toggle;
 * this one does the same and also rebuilds after a swap.
 */

type Refresher = () => void;

const backdrop = () => document.querySelector("pixel-backdrop");

/**
 * The knobs as the backdrop shows them, so the ghost and noise sliders read
 * the shown toy's look. Saving reads the raw options instead, so only a
 * tweak persists, not a look.
 */
const current = (): BackdropKnobs => {
  const element = backdrop();
  return element === null
    ? readDefaults()
    : { ...element.options, ...element.look };
};

export const STORAGE_KEY = "pixel-backdrop";

/**
 * Only keys the element still has, with the type it expects: storage outlives
 * schema changes, and a stale key must not leak into the options.
 */
export function loadSaved(options: object): Partial<BackdropKnobs> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "");
    if (typeof saved !== "object" || saved === null) return {};
    const known = options as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(saved).filter(
        ([key, value]) => key in known && typeof value === typeof known[key],
      ),
    );
  } catch {
    return {};
  }
}

let pending: Partial<BackdropKnobs> = {};
let updateQueued = false;
let saveTimeout: number | undefined;

/**
 * Store only what differs from the defaults, so later changes to the CSS
 * defaults still reach keys the user never touched.
 */
export function persistChanges(options: BackdropKnobs) {
  const defaults = readDefaults();
  const changes = Object.fromEntries(
    Object.entries(options).filter(
      ([key, value]) => value !== defaults[key as keyof BackdropKnobs],
    ),
  );
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(changes));
  } catch {
    // Storage may be unavailable (private mode); tweaks just won't persist.
  }
}

/** Sliders fire on every pointer move; coalesce the synchronous writes. */
const save = () => {
  window.clearTimeout(saveTimeout);
  saveTimeout = window.setTimeout(() => {
    const options = backdrop()?.options;
    if (options) persistChanges(options);
  }, 250);
};

const clearSaved = () => {
  window.clearTimeout(saveTimeout);
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage may be unavailable; there is nothing to clear.
  }
};

/**
 * Sliders fire many `input` events per drag; merge them and apply once a frame
 * so the canvas isn't reconfigured and repainted several times per frame.
 */
const update = (partial: Partial<BackdropKnobs>) => {
  pending = { ...pending, ...partial };
  if (updateQueued) return;
  updateQueued = true;
  requestAnimationFrame(() => {
    updateQueued = false;
    const next = pending;
    pending = {};
    backdrop()?.configure(next);
    save();
  });
};

function makeRow(panel: HTMLElement, text: string) {
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
  panel.appendChild(row);
  return { label, control, output };
}

const toyChoices = Object.fromEntries(TOYS.map((toy) => [toy.id, toy.label]));

function addToy(panel: HTMLElement, refreshers: Refresher[]) {
  const { control: cell, output } = makeRow(panel, "Toy");
  output.remove();
  // Not persisted: the dev picker is for tuning, not a user preference.
  const select = addSelect(cell, "Toy", toyChoices);
  // Toys are random per navigation, so the select must not assume one.
  refreshers.push(() => {
    select.value = backdrop()?.toy ?? select.value;
  });
  select.addEventListener("change", () => {
    backdrop()?.setToy(select.value);
    for (const refresh of refreshers) refresh();
  });
}

function addKnob(
  panel: HTMLElement,
  refreshers: Refresher[],
  key: keyof BackdropKnobs,
  control: Control,
) {
  if (control.heading) {
    const heading = document.createElement("div");
    heading.className = "heading";
    heading.textContent = control.heading;
    panel.appendChild(heading);
  }

  const { label, control: cell, output } = makeRow(panel, control.label);
  const value = () => current()[key];

  if (control.kind === "range") {
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(control.min);
    input.max = String(control.max);
    input.step = String(control.step);
    input.id = `pixel-backdrop-${key}`;
    label.htmlFor = input.id;
    cell.appendChild(input);

    const show = (value: number) => {
      output.textContent = `${value}${control.suffix ?? ""}`;
    };
    refreshers.push(() => {
      input.value = String(value());
      show(value() as number);
    });
    input.addEventListener("input", () => {
      const value = Number(input.value);
      show(value);
      update({ [key]: value });
    });
  } else if (control.kind === "color") {
    const input = document.createElement("input");
    input.type = "color";
    input.id = `pixel-backdrop-${key}`;
    label.htmlFor = input.id;
    cell.appendChild(input);

    refreshers.push(() => {
      input.value = output.textContent = value() as string;
    });
    input.addEventListener("input", () => {
      output.textContent = input.value;
      update({ [key]: input.value });
    });
  } else if (control.kind === "toggle") {
    output.remove();
    const toggle = document.createElement("astro-dev-toolbar-toggle");
    toggle.toggleStyle = "gray";
    cell.appendChild(toggle);

    // Read the input, not `current()`: the write to the element is deferred a
    // frame, so the options are still stale when `change` fires.
    const syncDisabled = () => {
      if (!control.disables) return;
      const target = panel.querySelector<HTMLInputElement>(
        `#pixel-backdrop-${control.disables}`,
      );
      if (!target) return;
      target.disabled = toggle.input.checked;
      target
        .closest(".row")
        ?.toggleAttribute("data-disabled", toggle.input.checked);
    };
    refreshers.push(() => {
      toggle.input.checked = value() as boolean;
      syncDisabled();
    });
    toggle.input.addEventListener("change", () => {
      update({ [key]: toggle.input.checked });
      syncDisabled();
    });
  } else {
    output.remove();
    const select = addSelect(cell, control.label, control.choices);
    refreshers.push(() => {
      select.value = value() as string;
    });
    select.addEventListener("change", () => {
      update({ [key]: select.value });
    });
  }
}

function addSelect(
  cell: HTMLElement,
  label: string,
  choices: Record<string, string>,
) {
  const select = document.createElement("astro-dev-toolbar-select");
  select.selectStyle = "gray";
  select.setAttribute("aria-label", label);
  for (const [value, text] of Object.entries(choices)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    // Append to the native select directly: the component moves slotted
    // options into it on a later `slotchange`, so a synchronous `.value` set
    // would be lost.
    select.element.appendChild(option);
  }
  cell.appendChild(select);
  return select.element;
}

/** (Re)build the pane in the app's shadow root, replacing any earlier mount. */
let paneLife: AbortController | undefined;

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
  addToy(panel, refreshers);
  for (const [key, { control }] of Object.entries(KNOBS)) {
    addKnob(panel, refreshers, key as keyof BackdropKnobs, control);
  }
  for (const refresh of refreshers) refresh();
  paneLife?.abort();
  paneLife = new AbortController();
  document.addEventListener(
    "astro:page-load",
    () => {
      for (const refresh of refreshers) refresh();
    },
    { signal: paneLife.signal },
  );

  const actions = document.createElement("div");
  actions.className = "actions";
  const reset = document.createElement("astro-dev-toolbar-button");
  reset.buttonStyle = "gray";
  reset.size = "small";
  reset.textContent = "Reset";
  reset.addEventListener("click", () => {
    backdrop()?.reset();
    clearSaved();
    for (const refresh of refreshers) refresh();
  });
  actions.appendChild(reset);
  panel.appendChild(actions);
}

export default defineToolbarApp({
  init(canvas, app) {
    // Restore here, not in renderPane: the persisted backdrop keeps its options
    // across view transitions, so re-applying storage after a swap would
    // clobber live tweaks.
    const element = backdrop();
    if (element) element.configure(loadSaved(element.options));
    renderPane(canvas);

    // The toolbar re-appends itself on every view transition, which resets each
    // app canvas. Rebuild after the swap, and whenever the app is switched on.
    document.addEventListener("astro:after-swap", () => renderPane(canvas));
    app.onToggled(({ state }) => {
      if (state) renderPane(canvas);
    });
  },
});
