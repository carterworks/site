import { afterEach, expect, test } from "vitest";
import { isToyPress, type NodeAtPoint } from "./backdrop-press";

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

const nowhere: NodeAtPoint = () => null;

test("a press in empty space is accepted, wherever the window itself is the target", () => {
  expect(isToyPress(press(document.body), nowhere)).toBe(true);
  expect(isToyPress(press(window), nowhere)).toBe(true);
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
  "dialog",
])("a press inside %s is rejected", (selector) => {
  const name = /^[a-z-]+$/.test(selector) ? selector : "div";
  const outer = document.createElement(name);
  if (name === "div") {
    outer.setAttribute(selector.slice(1, -1), "");
  }
  const inner = document.createElement("span");
  outer.append(inner);
  document.body.append(outer);

  expect(isToyPress(press(inner), nowhere)).toBe(false);
});

test.each([
  ["a secondary button", { button: 2 }],
  ["a middle button", { button: 1 }],
  ["a non-primary touch", { pointerType: "touch", isPrimary: false }],
  ["a non-primary pen", { pointerType: "pen", isPrimary: false }],
] as const)("%s is rejected", (_, init) => {
  expect(isToyPress(press(document.body, init), nowhere)).toBe(false);
});

test.each(["touch", "pen"])(
  "a primary %s contact is accepted",
  (pointerType) => {
    expect(isToyPress(press(document.body, { pointerType }), nowhere)).toBe(
      true,
    );
  },
);

const words = () => document.createTextNode("Some words");
const line = () => [new DOMRect(10, 10, 100, 20)];

test("a press on the rects of the text under the caret is rejected", () => {
  const node = words();
  const event = press(document.body, { clientX: 50, clientY: 20 });

  expect(isToyPress(event, () => node, line)).toBe(false);
});

test("a press in the gap beside the text the caret snapped to is accepted", () => {
  const node = words();
  const event = press(document.body, { clientX: 300, clientY: 20 });

  expect(isToyPress(event, () => node, line)).toBe(true);
});

test("a caret that lands on no text leaves the press accepted", () => {
  const event = press(document.body, { clientX: 50, clientY: 20 });

  expect(isToyPress(event, () => document.body, line)).toBe(true);
});
