// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DiscussionPage } from "../src/app/DiscussionPage";
import { DISCUSSIONS_STORAGE_KEY } from "../src/domain/discussion-store";
import { defaultProfile } from "../src/domain/income";

const now = new Date("2026-09-23T01:00:00.000Z");
const profile = { ...defaultProfile(now), income: "10000", timeZone: "Asia/Shanghai" };

function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function click(selector: string) {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) throw new Error(`missing ${selector}`);
  element.click();
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(<DiscussionPage profile={profile} now={now} unsaved={false} />);
  });
  return {
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function preparePurchase() {
  await settle();
  await act(async () => {
    fill(document.querySelector("#purchase-price") as HTMLInputElement, "1000");
    fill(document.querySelector("#purchase-category") as HTMLInputElement, "家电");
    fill(document.querySelector("#purchase-reason") as HTMLTextAreaElement, "旧的坏了");
  });
  await vi.waitFor(() => {
    expect(document.body.textContent).toContain("事实卡");
    expect(document.body.textContent).not.toContain("填入有效且已确认的价格后");
  });
}

function storedRecords(): Array<{ id: string; rationale: string | null }> {
  const raw = localStorage.getItem(DISCUSSIONS_STORAGE_KEY);
  if (!raw) return [];
  const document = JSON.parse(raw) as { records: Array<{ id: string; decision: { rationale: string } | null }> };
  return document.records.map((record) => ({ id: record.id, rationale: record.decision?.rationale ?? null }));
}

describe("discussion page save", () => {
  const roots: Array<{ unmount(): void }> = [];

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (_name: string, _options: unknown, callback: () => Promise<unknown>) => callback(),
      },
    });
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(null, { status: 404 })));
  });

  afterEach(() => {
    for (const view of roots.splice(0)) view.unmount();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Reflect.deleteProperty(document, "visibilityState");
    if (document.visibilityState !== "visible") {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    }
  });

  it("选完决定后 400ms 内卸载，讨论已经写进本地", async () => {
    const view = mount();
    roots.push(view);
    await preparePurchase();
    await act(async () => {
      click("#discussion-decision-wait");
    });
    view.unmount();
    roots.splice(0, roots.length);
    await vi.waitFor(() => {
      expect(storedRecords()).toEqual([expect.objectContaining({ rationale: "" })]);
    });
    const raw = localStorage.getItem(DISCUSSIONS_STORAGE_KEY) ?? "";
    expect(raw).toContain("家电");
    expect(raw).toContain("wait");
  });

  it("选完决定后页面变为不可见，不等 400ms 定时器就已经写入", async () => {
    vi.useFakeTimers();
    const view = mount();
    roots.push(view);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      fill(document.querySelector("#purchase-price") as HTMLInputElement, "1000");
      fill(document.querySelector("#purchase-category") as HTMLInputElement, "家电");
      fill(document.querySelector("#purchase-reason") as HTMLTextAreaElement, "旧的坏了");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(document.body.textContent).toContain("事实卡");
    await act(async () => {
      click("#discussion-decision-wait");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(storedRecords()).toEqual([]);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(storedRecords().length).toBe(1);
    expect(localStorage.getItem(DISCUSSIONS_STORAGE_KEY)).toContain("家电");
  });

  it("删除当前讨论后再改依据，不会写回去，并说明不会保存", async () => {
    const view = mount();
    roots.push(view);
    await preparePurchase();
    await act(async () => {
      click("#discussion-decision-wait");
    });
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("这次讨论已保存在此浏览器");
    });
    const savedId = storedRecords()[0]?.id;
    const deleteButton = [...document.querySelectorAll("button")].find((button) => button.textContent === "删除这条讨论");
    if (!deleteButton) throw new Error("missing delete");
    await act(async () => {
      deleteButton.click();
    });
    const confirm = [...document.querySelectorAll("button")].find((button) => button.textContent === "确认删除");
    if (!confirm) throw new Error("missing confirm");
    await act(async () => {
      confirm.click();
    });
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("已删除这一条讨论");
    });
    await act(async () => {
      fill(document.querySelector("#decision-note") as HTMLTextAreaElement, "改了依据，不该再写回去");
    });
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("这条讨论已删除，之后的修改不会保存");
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const records = storedRecords();
    expect(records.map((record) => record.id)).not.toContain(savedId);
    expect(JSON.stringify(records)).not.toContain("不该再写回去");
  });

  it("删除失败后，继续修改仍然能保存", async () => {
    const view = mount();
    roots.push(view);
    await preparePurchase();
    await act(async () => {
      click("#discussion-decision-wait");
    });
    await vi.waitFor(() => {
      expect(storedRecords().length).toBe(1);
      expect([...document.querySelectorAll("button")].some((button) => button.textContent === "删除这条讨论")).toBe(true);
    });
    const workingLocks = navigator.locks;
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async () => ({ status: "unavailable", reason: "write-failed" }),
      },
    });
    const deleteButton = [...document.querySelectorAll("button")].find((button) => button.textContent === "删除这条讨论");
    if (!deleteButton) throw new Error("missing delete");
    await act(async () => {
      deleteButton.click();
    });
    const confirm = [...document.querySelectorAll("button")].find((button) => button.textContent === "确认删除");
    if (!confirm) throw new Error("missing confirm");
    await act(async () => {
      confirm.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.body.textContent).toContain("没有删成");
    expect(storedRecords().length).toBe(1);
    Object.defineProperty(navigator, "locks", { configurable: true, value: workingLocks });
    await act(async () => {
      fill(document.querySelector("#decision-note") as HTMLTextAreaElement, "删除没成功，这条要留下");
    });
    await vi.waitFor(() => {
      expect(storedRecords()).toEqual([expect.objectContaining({ rationale: "删除没成功，这条要留下" })]);
    });
  });

  it("删除等待期间改了类别，删除失败后新讨论不会覆盖旧记录", async () => {
    const view = mount();
    roots.push(view);
    await preparePurchase();
    await act(async () => {
      click("#discussion-decision-wait");
    });
    await vi.waitFor(() => {
      expect(storedRecords().length).toBe(1);
      expect([...document.querySelectorAll("button")].some((button) => button.textContent === "删除这条讨论")).toBe(true);
    });
    const savedId = storedRecords()[0]?.id;
    if (!savedId) throw new Error("missing saved id");
    let release: (value: unknown) => void = () => undefined;
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: () => new Promise((resolve) => {
          release = resolve;
        }),
      },
    });
    const deleteButton = [...document.querySelectorAll("button")].find((button) => button.textContent === "删除这条讨论");
    if (!deleteButton) throw new Error("missing delete");
    await act(async () => {
      deleteButton.click();
    });
    const confirm = [...document.querySelectorAll("button")].find((button) => button.textContent === "确认删除");
    if (!confirm) throw new Error("missing confirm");
    await act(async () => {
      confirm.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      fill(document.querySelector("#purchase-category") as HTMLInputElement, "书籍");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      release({ status: "unavailable", reason: "write-failed" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.body.textContent).toContain("没有删成");
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (_name: string, _options: unknown, callback: () => Promise<unknown>) => callback(),
      },
    });
    await act(async () => {
      click("#discussion-decision-wait");
    });
    await vi.waitFor(() => {
      expect(storedRecords()).toHaveLength(2);
    });
    const saved = JSON.parse(localStorage.getItem(DISCUSSIONS_STORAGE_KEY) ?? "") as { records: Array<{ id: string; category: string }> };
    expect(saved.records.find((item) => item.id === savedId)?.category).toBe("家电");
    expect(saved.records.find((item) => item.id !== savedId)?.category).toBe("书籍");
  });

  it("记录已经不在时，提示已不存在并刷新列表", async () => {
    const view = mount();
    roots.push(view);
    await preparePurchase();
    await act(async () => {
      click("#discussion-decision-wait");
    });
    await vi.waitFor(() => {
      expect(document.querySelector(".saved-discussions")?.textContent).toContain("家电");
    });
    const raw = localStorage.getItem(DISCUSSIONS_STORAGE_KEY);
    if (!raw) throw new Error("missing stored discussion");
    const stored = JSON.parse(raw) as { records: Array<{ id: string; category: string }> };
    const savedId = stored.records[0]?.id;
    if (!savedId) throw new Error("missing saved id");
    stored.records[0] = { ...stored.records[0], id: "other-tab-record", category: "另一标签页留下的" };
    localStorage.setItem(DISCUSSIONS_STORAGE_KEY, JSON.stringify(stored));
    const deleteButton = [...document.querySelectorAll("button")].find((button) => button.textContent === "删除这条讨论");
    if (!deleteButton) throw new Error("missing delete");
    await act(async () => {
      deleteButton.click();
    });
    const confirm = [...document.querySelectorAll("button")].find((button) => button.textContent === "确认删除");
    if (!confirm) throw new Error("missing confirm");
    await act(async () => {
      confirm.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.body.textContent).toContain("这条讨论已经不在了");
    expect(document.body.textContent).not.toContain("没有删成");
    const savedList = document.querySelector(".saved-discussions");
    expect(savedList?.textContent).toContain("另一标签页留下的");
    expect(savedList?.textContent).not.toContain("家电");
    const current = JSON.parse(localStorage.getItem(DISCUSSIONS_STORAGE_KEY) ?? "{}") as { records: Array<{ id: string }> };
    expect(current.records.map((item) => item.id)).toEqual(["other-tab-record"]);
    expect(current.records.map((item) => item.id)).not.toContain(savedId);
  });

  it("删除一条记录等待期间打开另一条，删除完成后仍保持打开", async () => {
    const view = mount();
    roots.push(view);
    await preparePurchase();
    await act(async () => {
      click("#discussion-decision-wait");
    });
    await vi.waitFor(() => {
      expect(storedRecords()).toHaveLength(1);
    });
    await act(async () => {
      fill(document.querySelector("#purchase-category") as HTMLInputElement, "书籍");
    });
    await act(async () => {
      click("#discussion-decision-wait");
    });
    await vi.waitFor(() => {
      expect(document.querySelectorAll(".saved-discussions li")).toHaveLength(2);
    });
    const row = (category: string) => {
      const item = [...document.querySelectorAll(".saved-discussions li")].find((entry) => entry.textContent?.includes(category));
      if (!(item instanceof HTMLElement)) throw new Error(`missing ${category}`);
      return item;
    };
    const press = (item: HTMLElement, label: string) => {
      const button = [...item.querySelectorAll("button")].find((entry) => entry.textContent === label);
      if (!(button instanceof HTMLElement)) throw new Error(`missing ${label}`);
      button.click();
    };
    await act(async () => {
      press(row("家电"), "查看这条讨论");
    });
    expect(document.querySelector(".saved-detail")?.textContent).toContain("家电");
    let finishDelete: (() => Promise<unknown>) | undefined;
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: (_name: string, _options: unknown, callback: () => Promise<unknown>) => new Promise((resolve, reject) => {
          finishDelete = () => Promise.resolve(callback()).then(resolve, reject);
        }),
      },
    });
    await act(async () => {
      press(row("家电"), "删除这条讨论");
    });
    const confirm = [...document.querySelectorAll("button")].find((button) => button.textContent === "确认删除");
    if (!confirm) throw new Error("missing confirm");
    await act(async () => {
      confirm.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    if (!finishDelete) throw new Error("delete did not request the lock");
    await act(async () => {
      press(row("书籍"), "查看这条讨论");
    });
    expect(document.querySelector(".saved-detail")?.textContent).toContain("书籍");
    await act(async () => {
      await finishDelete?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.body.textContent).toContain("已删除这一条讨论");
    expect(document.querySelector(".saved-discussions")?.textContent).not.toContain("家电");
    expect(document.querySelector(".saved-detail")?.textContent ?? "").toContain("书籍");
  });
});
