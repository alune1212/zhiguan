export type PageLifecycleEventName = "pagehide";

export interface PageLifecycleTarget {
  addEventListener(
    type: PageLifecycleEventName,
    listener: (event: unknown) => void,
  ): void;
  removeEventListener(
    type: PageLifecycleEventName,
    listener: (event: unknown) => void,
  ): void;
}

export interface ApplicationCleanupResult {
  /** Only application-controlled in-memory references are cleared. */
  readonly applicationStateCleared: true;
  /** The adapter makes no claim about servers or remote state. */
  readonly serverStateUntouched: true;
  /** Downloads already handed to the user remain outside application control. */
  readonly downloadedFilesRemainUserControlled: true;
}

export interface LifecycleBinding {
  readonly detach: () => void;
  readonly clearNow: (reason?: "user-exit" | "pagehide") => ApplicationCleanupResult;
  /** Re-arm pagehide cleanup for a newly started in-memory session. */
  readonly reset: () => void;
}

/**
 * Bind pagehide to an application-owned clear callback. Explicit clearNow
 * calls are idempotent and receive no page data; no unload beacon, storage
 * write, or server request is attempted. A newly started in-memory session
 * can re-arm pagehide cleanup with reset(), including after bfcache restore.
 * Detaching is idempotent.
 */
export function bindPagehideCleanup(
  target: PageLifecycleTarget,
  clearApplicationState: () => void,
): LifecycleBinding {
  let detached = false;
  let cleared = false;

  const clearNow = (
    _reason: "user-exit" | "pagehide" = "user-exit",
  ): ApplicationCleanupResult => {
    if (!cleared) {
      cleared = true;
      clearApplicationState();
    }
    return {
      applicationStateCleared: true,
      serverStateUntouched: true,
      downloadedFilesRemainUserControlled: true,
    };
  };

  const listener = (_event: unknown): void => {
    if (detached) return;
    clearNow("pagehide");
  };

  target.addEventListener("pagehide", listener);

  return {
    detach: (): void => {
      if (detached) {
        return;
      }
      detached = true;
      target.removeEventListener("pagehide", listener);
    },
    clearNow,
    reset: (): void => {
      if (!detached) cleared = false;
    },
  };
}
