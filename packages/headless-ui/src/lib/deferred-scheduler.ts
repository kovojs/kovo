/**
 * Deferred scheduling for primitive side effects (e.g. focus) that must run
 * after the client runtime has committed state mutations AND flushed its
 * binding updates to the DOM.
 *
 * Why this exists (SPEC §4.3/§4.8): primitives such as `dropdown-menu`,
 * `menubar`, and `context-menu` open a menu by mutating island state and then
 * want to move focus into the freshly revealed content. The element they focus
 * is only un-hidden when the runtime runs the update plan (bindings → derives →
 * stamps, §4.8), and derive bindings resolve through an awaited dynamic
 * `import()` (a LATER microtask).
 * A bare `setTimeout(callback, 0)` therefore fires while the target is still
 * inside a `hidden`/`display:none` subtree, so `.focus()` is a silent no-op and
 * keyboard navigation never enters the menu.
 *
 * To fix this at the root without coupling `@kovojs/headless-ui` to
 * `@kovojs/runtime`, the runtime publishes a POST-COMMIT scheduler on a
 * well-known global while a delegated event is in flight. Primitives route
 * their deferred work through {@link scheduleDeferred}, which prefers that
 * runtime hook and falls back to `setTimeout(callback, 0)` when no runtime is
 * active (server rendering, tests, or non-Kovo hosts). The runtime drains the
 * queued callbacks only AFTER `await applyStateBindings(...)` resolves, so the
 * target is guaranteed to be revealed before focus runs.
 */

/** A deferred callback (typically a focus move) to run after the commit. */
export type DeferredCallback = () => void;

/** Schedules a deferred callback; receives the callback to defer. */
export type DeferredScheduler = (callback: DeferredCallback) => void;

/**
 * Global hook the client runtime installs while a delegated event dispatch is
 * in flight. When present, {@link scheduleDeferred} enqueues callbacks here so
 * the runtime can drain them after committing state and flushing bindings.
 */
const POST_COMMIT_GLOBAL_KEY = '__kovo_postCommitSchedule';

interface PostCommitGlobal {
  [POST_COMMIT_GLOBAL_KEY]?: DeferredScheduler;
}

function postCommitScheduler(): DeferredScheduler | undefined {
  const scheduler = (globalThis as PostCommitGlobal)[POST_COMMIT_GLOBAL_KEY];
  return typeof scheduler === 'function' ? scheduler : undefined;
}

/**
 * Default deferred scheduler used by primitives. Prefers the runtime's
 * post-commit hook (so the callback runs after the DOM is revealed) and falls
 * back to `setTimeout(callback, 0)` when no runtime is active.
 */
export function scheduleDeferred(callback: DeferredCallback): void {
  const scheduler = postCommitScheduler();
  if (scheduler) {
    scheduler(callback);
    return;
  }
  setTimeout(callback, 0);
}
