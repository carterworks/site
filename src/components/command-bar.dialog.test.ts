import { beforeEach, describe, expect, test } from "vitest";
import { getElement, setupCommandBar } from "./command-bar.fixture";

describe("command bar dialog", () => {
  beforeEach(setupCommandBar);

  test("Escape returns from settings before closing the dialog", () => {
    getElement<HTMLButtonElement>(".command-trigger").click();
    getElement<HTMLButtonElement>("[data-settings]").click();
    const dialog = getElement<HTMLDialogElement>("dialog");

    const firstCancel = new Event("cancel", { cancelable: true });
    if (dialog.dispatchEvent(firstCancel)) dialog.close();

    expect(dialog.open).toBe(true);
    expect(getElement<HTMLElement>('[data-panel="root"]').hidden).toBe(false);
    expect(getElement<HTMLElement>('[data-panel="settings"]').hidden).toBe(
      true,
    );

    const secondCancel = new Event("cancel", { cancelable: true });
    if (dialog.dispatchEvent(secondCancel)) dialog.close();

    expect(dialog.open).toBe(false);
  });

  test("Shift+Enter toggles appearance without closing the dialog", () => {
    getElement<HTMLButtonElement>(".command-trigger").click();
    getElement<HTMLButtonElement>("[data-settings]").click();
    const dialog = getElement<HTMLDialogElement>("dialog");
    const input = getElement<HTMLInputElement>("input");

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(
      getElement<HTMLButtonElement>("[data-appearance]").getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(dialog.open).toBe(true);
  });
});
