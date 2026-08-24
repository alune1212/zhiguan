import { describe, expect, it } from "vitest";

import { bindPagehideCleanup, type PageLifecycleTarget } from "../../../src/adapters/browser/lifecycle";

class FakePage implements PageLifecycleTarget {
  private listener: ((event: unknown) => void) | null = null;

  addEventListener(_type: "pagehide", listener: (event: unknown) => void): void {
    this.listener = listener;
  }

  removeEventListener(_type: "pagehide", listener: (event: unknown) => void): void {
    if (this.listener === listener) {
      this.listener = null;
    }
  }

  pagehide(): void {
    this.listener?.({ type: "pagehide" });
  }
}

describe("page lifecycle adapter", () => {
  it("clears application memory once on pagehide and does not claim remote cleanup", () => {
    const page = new FakePage();
    let clearCount = 0;
    const binding = bindPagehideCleanup(page, () => {
      clearCount += 1;
    });

    page.pagehide();
    page.pagehide();
    const result = binding.clearNow("pagehide");

    expect(clearCount).toBe(1);
    expect(result).toEqual({
      applicationStateCleared: true,
      serverStateUntouched: true,
      downloadedFilesRemainUserControlled: true,
    });
  });

  it("detaches without invoking cleanup for later pagehide events", () => {
    const page = new FakePage();
    let clearCount = 0;
    const binding = bindPagehideCleanup(page, () => {
      clearCount += 1;
    });

    binding.detach();
    binding.detach();
    page.pagehide();

    expect(clearCount).toBe(0);
  });
});
