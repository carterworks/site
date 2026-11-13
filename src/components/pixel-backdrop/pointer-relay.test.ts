import { afterEach, beforeEach, expect, test } from "vitest";
import { relayPointer } from "./pointer-relay";

const TYPES = [
  "pointerdown",
  "pointermove",
  "pointerup",
  "pointercancel",
  "pointerleave",
];

let heard: PointerEvent[];
let stop: () => void;

beforeEach(() => {
  const canvas = new EventTarget();
  heard = [];
  for (const type of TYPES) {
    canvas.addEventListener(type, (event) => heard.push(event as PointerEvent));
  }
  stop = relayPointer(canvas);
});

afterEach(() => {
  stop();
  getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

const types = () => heard.map(({ type }) => type);

const press = (target: EventTarget, init: PointerEventInit = {}) =>
  target.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      isPrimary: true,
      pointerType: "mouse",
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      ...init,
    }),
  );

const FINGER = 7;

const fingerDown = (target: EventTarget = document.body) =>
  press(target, { pointerType: "touch", pointerId: FINGER });

const finger = (type: string, init: PointerEventInit = {}) =>
  window.dispatchEvent(
    new PointerEvent(type, {
      pointerType: "touch",
      pointerId: FINGER,
      clientX: 100,
      clientY: 100,
      ...init,
    }),
  );

/** Whether the page's scroll for a touchmove would be blocked. */
function scrollBlocked() {
  const move = new TouchEvent("touchmove", { bubbles: true, cancelable: true });
  document.body.dispatchEvent(move);
  return move.defaultPrevented;
}

const touchEnd = (type: string, touches: Touch[] = []) =>
  document.body.dispatchEvent(new TouchEvent(type, { bubbles: true, touches }));

const holding = () =>
  document.documentElement.hasAttribute("data-backdrop-holding");

test("a hover is passed to the canvas with what a plain canvas's event carries", () => {
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: 12,
      clientY: 34,
      pointerId: 3,
      pointerType: "pen",
      buttons: 0,
      isPrimary: true,
    }),
  );

  expect(heard).toHaveLength(1);
  expect(heard[0]).toMatchObject({
    type: "pointermove",
    clientX: 12,
    clientY: 34,
    pointerId: 3,
    pointerType: "pen",
    buttons: 0,
    isPrimary: true,
    bubbles: false,
  });
});

test("touch has no hover: a finger's moves reach the canvas only while it holds a grab", () => {
  finger("pointermove");
  expect(heard).toEqual([]);

  fingerDown();
  finger("pointermove", { clientX: 200 });
  finger("pointermove", { clientX: 220, pointerId: FINGER + 1 });

  expect(types()).toEqual(["pointerdown", "pointermove"]);
  expect(heard[1].clientX).toBe(200);
});

test("a press in the open reaches the canvas, suppresses selection and clears one already begun", () => {
  const paragraph = document.createElement("p");
  paragraph.textContent = "words";
  document.body.append(paragraph);
  getSelection()!.selectAllChildren(paragraph);

  press(document.body);

  expect(types()).toEqual(["pointerdown"]);
  expect(holding()).toBe(true);
  expect(getSelection()!.isCollapsed).toBe(true);
});

test.each(["a", "main", "header", "button"])(
  "a press on %s never reaches the canvas, grabs or suppresses selection",
  (tag) => {
    const content = document.createElement(tag);
    document.body.append(content);

    press(content);
    fingerDown(content);

    expect(heard).toEqual([]);
    expect(holding()).toBe(false);
    expect(scrollBlocked()).toBe(false);
  },
);

test("the hold's own pointerup reaches the canvas and ends it, and another pointer's does not", () => {
  press(document.body, { pointerId: 1 });

  window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 2 }));
  expect(holding()).toBe(true);

  window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
  expect(types()).toEqual(["pointerdown", "pointerup"]);
  expect(holding()).toBe(false);
});

test("a grabbed touch blocks the page's scroll from its first move until it lifts", () => {
  fingerDown();
  expect(scrollBlocked()).toBe(true);

  finger("pointerup");

  expect(scrollBlocked()).toBe(false);
  expect(types()).toEqual(["pointerdown", "pointerup"]);
});

test.each<[string, () => void]>([
  ["pointercancel", () => finger("pointercancel")],
  ["touchend", () => touchEnd("touchend")],
  ["touchcancel", () => touchEnd("touchcancel")],
  ["window blur", () => window.dispatchEvent(new Event("blur"))],
  [
    "a navigation",
    () => document.dispatchEvent(new Event("astro:before-swap")),
  ],
  ["stopping the relay", () => stop()],
])(
  "%s lets go of a grabbed touch, and the canvas hears it as a pointercancel",
  (_, end) => {
    fingerDown();

    end();

    expect(scrollBlocked()).toBe(false);
    expect(holding()).toBe(false);
    expect(types()).toEqual(["pointerdown", "pointercancel"]);
    expect(heard[1]).toMatchObject({ pointerId: FINGER, pointerType: "touch" });
  },
);

test("a second finger lifting does not let go of a grabbed touch", () => {
  fingerDown();

  touchEnd("touchend", [new Touch({ identifier: 0, target: document.body })]);
  finger("pointerup", { pointerId: FINGER + 1 });

  expect(scrollBlocked()).toBe(true);
});

test("the pointer leaving the page reaches the canvas as a pointerleave", () => {
  document.dispatchEvent(new MouseEvent("mouseleave"));

  expect(types()).toEqual(["pointerleave"]);
});

test("a new press lets go of the hold before it, which the canvas hears as a pointercancel", () => {
  press(document.body, { pointerId: 1 });
  press(document.body, { pointerId: 2 });

  expect(heard.map(({ type, pointerId }) => [type, pointerId])).toEqual([
    ["pointerdown", 1],
    ["pointercancel", 1],
    ["pointerdown", 2],
  ]);
  expect(holding()).toBe(true);
});

test("a mouse hold grabs nothing: the page still scrolls, and a lifting touch does not end it", () => {
  press(document.body);

  expect(scrollBlocked()).toBe(false);
  touchEnd("touchend");

  expect(holding()).toBe(true);
  expect(types()).toEqual(["pointerdown"]);
});

test("a pen hold grabs nothing: its moves reach the canvas and the page still scrolls", () => {
  press(document.body, { pointerType: "pen", pointerId: 2 });
  window.dispatchEvent(
    new PointerEvent("pointermove", { pointerType: "pen", pointerId: 2 }),
  );

  expect(scrollBlocked()).toBe(false);
  expect(holding()).toBe(true);
  expect(types()).toEqual(["pointerdown", "pointermove"]);
});

test("another pointer's pointercancel does not let go of a grabbed touch", () => {
  fingerDown();

  finger("pointercancel", { pointerId: FINGER + 1 });

  expect(scrollBlocked()).toBe(true);
  expect(holding()).toBe(true);
  expect(types()).toEqual(["pointerdown"]);
});

test("a window blur lets go of a mouse hold, which the canvas hears as a pointercancel", () => {
  press(document.body);

  window.dispatchEvent(new Event("blur"));

  expect(holding()).toBe(false);
  expect(heard.map(({ type, pointerType }) => [type, pointerType])).toEqual([
    ["pointerdown", "mouse"],
    ["pointercancel", "mouse"],
  ]);
});

test("the pointer leaving the page mid-hold reaches the canvas as a pointerleave, and the hold goes on", () => {
  press(document.body);

  document.dispatchEvent(new MouseEvent("mouseleave"));
  window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));

  expect(types()).toEqual(["pointerdown", "pointerleave", "pointerup"]);
});

test("with no hold, a blur or a navigation tells the canvas nothing", () => {
  window.dispatchEvent(new Event("blur"));
  document.dispatchEvent(new Event("astro:before-swap"));

  expect(heard).toEqual([]);
});

test("a stopped relay passes nothing on and grabs nothing, so the page scrolls", () => {
  stop();

  window.dispatchEvent(new PointerEvent("pointermove"));
  press(document.body);
  fingerDown();
  finger("pointermove");
  document.dispatchEvent(new MouseEvent("mouseleave"));

  expect(heard).toEqual([]);
  expect(scrollBlocked()).toBe(false);
  expect(holding()).toBe(false);
});
