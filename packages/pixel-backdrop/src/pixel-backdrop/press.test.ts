import { afterEach, expect, test } from "vitest";
import { isToyPress } from "./press";

afterEach(() => document.body.replaceChildren());

const press = (target: Element | Window, init: PointerEventInit = {}) => {
  const event = new PointerEvent("pointerdown", {
    button: 0,
    isPrimary: true,
    pointerType: "mouse",
    ...init,
  });
  Object.defineProperty(event, "target", { value: target });
  return event;
};

test("a press in empty space is accepted, wherever the window itself is the target", () => {
  expect(isToyPress(press(document.body))).toBe(true);
  expect(isToyPress(press(window))).toBe(true);
});

test.each([
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "label",
  "summary",
  "[contenteditable]",
  "[tabindex]",
  "command-bar",
  "play-toolbar",
  "dialog",
  "main",
  "header",
])("a press inside %s is rejected", (selector) => {
  const name = /^[a-z-]+$/.test(selector) ? selector : "div";
  const outer = document.createElement(name);
  if (name === "div") {
    outer.setAttribute(selector.slice(1, -1), "");
  }
  const inner = document.createElement("span");
  outer.append(inner);
  document.body.append(outer);

  expect(isToyPress(press(inner))).toBe(false);
});

test.each([
  ["a secondary button", { button: 2 }],
  ["a middle button", { button: 1 }],
  ["a non-primary touch", { pointerType: "touch", isPrimary: false }],
  ["a non-primary pen", { pointerType: "pen", isPrimary: false }],
] as const)("%s is rejected", (_, init) => {
  expect(isToyPress(press(document.body, init))).toBe(false);
});

test.each(["touch", "pen"])(
  "a primary %s contact is accepted",
  (pointerType) => {
    expect(isToyPress(press(document.body, { pointerType }))).toBe(true);
  },
);

test("with no caret API at all, empty background is accepted and main is rejected", () => {
  Reflect.deleteProperty(document, "caretPositionFromPoint");
  const main = document.createElement("main");
  const inner = document.createElement("span");
  main.append(inner);
  document.body.append(main);

  expect(isToyPress(press(document.body))).toBe(true);
  expect(isToyPress(press(inner))).toBe(false);
});
