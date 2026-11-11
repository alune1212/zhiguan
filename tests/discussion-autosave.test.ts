import { describe, expect, it } from "vitest";

import {
  bindDiscussionSaveFlush,
  createDiscussionLeaveFlush,
  createDiscussionSaveGate,
  createPendingDiscussionSave,
} from "../src/domain/discussion-autosave";

function pendingSaver() {
  let callback: (() => void) | null = null;
  const pending = createPendingDiscussionSave({
    set(next) {
      callback = next;
      return 1;
    },
    clear() {
      return undefined;
    },
  });
  return { pending, fire: () => callback?.() };
}

function eventHost() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    visibilityState: "visible",
    addEventListener(type: string, listener: () => void) {
      const group = listeners.get(type) ?? new Set<() => void>();
      group.add(listener);
      listeners.set(type, group);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    emit(type: string) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
}

describe("discussion autosave leave flush", () => {
  it("400ms 内离开页面仍写完已完成的讨论，取消掉的定时器不会再写一次", () => {
    const { pending, fire } = pendingSaver();
    const leaveFlush = createDiscussionLeaveFlush(pending);
    const writes: string[] = [];
    leaveFlush.arm(
      () => writes.push("now"),
      () => writes.push("later"),
      400,
    );
    leaveFlush.disarm();
    leaveFlush.leave();
    fire();
    expect(writes).toEqual(["now"]);
  });

  it("pagehide、进入后台和卸载会立刻保存，页面仍可见时不会提前写", () => {
    const { pending } = pendingSaver();
    const leaveFlush = createDiscussionLeaveFlush(pending);
    const host = eventHost();
    const writes: string[] = [];
    const stop = bindDiscussionSaveFlush(() => leaveFlush.leave(), { window: host, document: host });
    leaveFlush.arm(() => writes.push("now"), () => writes.push("later"), 400);
    host.emit("visibilitychange");
    expect(writes).toEqual([]);
    host.emit("pagehide");
    host.visibilityState = "hidden";
    host.emit("visibilitychange");
    expect(writes).toEqual(["now"]);
    leaveFlush.arm(() => writes.push("route"), () => writes.push("later-route"), 400);
    stop();
    expect(writes).toEqual(["now", "route"]);
  });
});

describe("deleted discussion identity", () => {
  it("删除当前讨论后，再改依据不会重新领取这条记录的保存身份", () => {
    const gate = createDiscussionSaveGate();
    const id = gate.claim(() => "discussion-1");
    const generation = gate.generation;
    expect(id).toBe("discussion-1");
    expect(gate.blockDeleted("discussion-1")).toBe(true);
    expect(gate.stillCurrent(generation, "discussion-1")).toBe(false);
    expect(gate.isDeleted("discussion-1")).toBe(true);
    expect(gate.claim(() => "discussion-2")).toBeNull();

    gate.undoBlock("discussion-1", true);
    expect(gate.claim(() => "discussion-2")).toBe("discussion-1");
    expect(gate.stillCurrent(gate.generation, "discussion-1")).toBe(true);
  });

  it("删除别的讨论或换一笔购买时，不会挡住当前讨论以后的保存", () => {
    const gate = createDiscussionSaveGate();
    expect(gate.claim(() => "current")).toBe("current");
    expect(gate.blockDeleted("other")).toBe(false);
    expect(gate.claim(() => "unused")).toBe("current");
    expect(gate.isDeleted("other")).toBe(true);

    const previousId = gate.blockAll();
    expect(previousId).toBe("current");
    expect(gate.claim(() => "revived")).toBeNull();
    gate.undoBlockAll(previousId);
    expect(gate.claim(() => "revived")).toBe("current");

    gate.resetForNewPurchase();
    expect(gate.claim(() => "discussion-2")).toBe("discussion-2");
    expect(gate.isDeleted("other")).toBe(true);
  });
});
