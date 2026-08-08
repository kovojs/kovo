/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked through pinned Reflect.apply. */

/**
 * Parent-process supervision for long-lived CLI sessions (`kovo check source --watch`,
 * `kovo dev`).
 *
 * plans/good-perf.md O6: watch sessions killed together with their spawning harness kept
 * running after being reparented to launchd/init, burning ~39% of a core each until manually
 * reaped. A long-lived Kovo CLI session must exit when the process that invoked it dies —
 * POSIX reparents an orphan, so a changed parent pid is proof the invoker is gone.
 */

const NativeAbortController = globalThis.AbortController;
const NativeDate = globalThis.Date;
const NativeReflect = globalThis.Reflect;
const nativeReflectApply = NativeReflect.apply;
const nativeSetInterval = globalThis.setInterval;
const nativeClearInterval = globalThis.clearInterval;
const nativeDateNow = NativeDate.now;

const DEFAULT_PARENT_POLL_INTERVAL_MS = 2_000;

/** @internal One supervised CLI session lifetime. */
export interface KovoCliSessionSupervision {
  /** Stop supervision; used on ordinary session shutdown. */
  close(): void;
  /** Aborts when the invoking parent process is gone. */
  readonly signal: AbortSignal;
}

/** @internal Test seams; production callers pass none of these. */
export interface KovoCliSessionSupervisionControls {
  readonly onOrphaned?: (message: string) => void;
  readonly pollIntervalMs?: number;
  readonly readParentPid?: () => number;
}

/**
 * @internal Abort the returned signal when the parent process that invoked this CLI session
 * dies. The poll timer is unref'd, so supervision never keeps an exiting process alive.
 */
export function superviseKovoCliSessionParent(
  controls: KovoCliSessionSupervisionControls = {},
): KovoCliSessionSupervision {
  const readParentPid = controls.readParentPid ?? (() => process.ppid);
  const pollIntervalMs = controls.pollIntervalMs ?? DEFAULT_PARENT_POLL_INTERVAL_MS;
  if (
    typeof pollIntervalMs !== 'number' ||
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs < 25 ||
    pollIntervalMs > 60_000
  ) {
    throw new TypeError('Kovo CLI session supervision pollIntervalMs must be 25..60000.');
  }
  const controller = new NativeAbortController();
  const initialParentPid = readParentPid();
  let closed = false;

  const timer = nativeSetInterval(() => {
    let parentPid: number;
    try {
      parentPid = readParentPid();
    } catch {
      return;
    }
    // POSIX guarantees a process's parent pid only ever changes when the parent dies and the
    // orphan is reparented (to pid 1 or a subreaper). Any change is proof the invoker is gone.
    if (parentPid === initialParentPid) return;
    close();
    try {
      controls.onOrphaned?.(
        `[kovo] the invoking parent process (pid ${initialParentPid}) is gone at ` +
          `${new NativeDate(nativeReflectApply(nativeDateNow, NativeDate, [])).toISOString()}; ` +
          'shutting this session down instead of running orphaned.\n',
      );
    } finally {
      controller.abort();
    }
  }, pollIntervalMs);
  (timer as { unref?: () => void }).unref?.();

  const close = (): void => {
    if (closed) return;
    closed = true;
    nativeClearInterval(timer);
  };

  return {
    close,
    signal: controller.signal,
  };
}
