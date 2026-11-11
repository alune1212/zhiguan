export function createPendingDiscussionSave(timers: {
  readonly set: (callback: () => void, delayMs: number) => unknown;
  readonly clear: (handle: unknown) => void;
}) {
  let pending: (() => void) | null = null;
  let handle: unknown = null;
  const clearTimer = () => {
    if (handle === null) return;
    timers.clear(handle);
    handle = null;
  };
  return {
    schedule(task: () => void, delayMs: number) {
      clearTimer();
      pending = task;
      handle = timers.set(() => {
        if (pending !== task) return;
        handle = null;
        pending = null;
        task();
      }, delayMs);
    },
    cancelTimer: clearTimer,
    drop() {
      clearTimer();
      pending = null;
    },
  };
}

type PendingDiscussionSave = ReturnType<typeof createPendingDiscussionSave>;

export function createDiscussionLeaveFlush(pending: PendingDiscussionSave) {
  let saveNow: (() => void) | null = null;
  return {
    arm(saveNowFn: () => void, saveLater: () => void, delayMs: number) {
      let spent = false;
      const run = (fn: () => void) => {
        if (spent) return;
        spent = true;
        saveNow = null;
        fn();
      };
      saveNow = () => run(saveNowFn);
      pending.schedule(() => run(saveLater), delayMs);
    },
    /** 只取消定时器。卸载清理若先跑到这里，离开页面仍要能写完。 */
    disarm() {
      pending.cancelTimer();
    },
    forget() {
      pending.drop();
      saveNow = null;
    },
    leave() {
      const save = saveNow;
      pending.drop();
      saveNow = null;
      save?.();
    },
  };
}

export function bindDiscussionSaveFlush(
  flush: () => void,
  host: {
    readonly window: { addEventListener(type: string, listener: () => void): void; removeEventListener(type: string, listener: () => void): void };
    readonly document: { readonly visibilityState: string; addEventListener(type: string, listener: () => void): void; removeEventListener(type: string, listener: () => void): void };
  },
): () => void {
  const onPageHide = () => flush();
  const onVisibility = () => {
    if (host.document.visibilityState === "hidden") flush();
  };
  host.window.addEventListener("pagehide", onPageHide);
  host.document.addEventListener("visibilitychange", onVisibility);
  return () => {
    host.window.removeEventListener("pagehide", onPageHide);
    host.document.removeEventListener("visibilitychange", onVisibility);
    flush();
  };
}

export function createDiscussionSaveGate() {
  let recordId: string | null = null;
  let hold = false;
  let generation = 0;
  let deletedHoldGeneration = 0;
  let clearHoldGeneration = 0;
  const deletedIds = new Set<string>();
  return {
    get generation() {
      return generation;
    },
    get held() {
      return hold;
    },
    claim(createId: () => string) {
      if (hold) return null;
      recordId ??= createId();
      if (deletedIds.has(recordId)) return null;
      return recordId;
    },
    stillCurrent(scheduledGeneration: number, id: string) {
      return !hold && generation === scheduledGeneration && recordId === id && !deletedIds.has(id);
    },
    isDeleted(id: string) {
      return deletedIds.has(id);
    },
    blockDeleted(id: string) {
      deletedIds.add(id);
      const wasCurrent = recordId === id;
      if (!wasCurrent) return false;
      recordId = null;
      hold = true;
      generation += 1;
      deletedHoldGeneration = generation;
      return true;
    },
    undoBlock(id: string, wasCurrent: boolean) {
      deletedIds.delete(id);
      // 等待期间换了购买，generation 已经往前走，不能把旧编号套回去。
      if (!wasCurrent || generation !== deletedHoldGeneration) return;
      recordId = id;
      hold = false;
    },
    blockAll() {
      const previousId = recordId;
      if (previousId) deletedIds.add(previousId);
      recordId = null;
      hold = true;
      generation += 1;
      clearHoldGeneration = generation;
      return previousId;
    },
    undoBlockAll(previousId: string | null) {
      if (previousId) deletedIds.delete(previousId);
      if (generation !== clearHoldGeneration) return;
      recordId = previousId;
      hold = false;
    },
    resetForNewPurchase() {
      recordId = null;
      hold = false;
      generation += 1;
    },
  };
}
