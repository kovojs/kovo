import type { QueryBindingRoot } from './query-bindings.js';
import type { QueryStore } from './query-store.js';

/** Runtime API used by generated clock update plans. */
export interface ClockUpdatePlan {
  clocks: Readonly<Record<string, ClockUpdateSpec | undefined>>;
  update(root: QueryBindingRoot, now: Record<string, Date>, context: ClockUpdateContext): unknown;
}

/** Runtime API used by generated clock update plans. */
export interface ClockUpdateSpec {
  every?: number | string;
  renderOnce?: true;
}

/** Runtime API used by generated clock update plans. */
export interface ClockUpdateContext {
  queryStore?: QueryStore;
}

interface ClockSubscription {
  nextDue: Map<string, number>;
  plan: ClockUpdatePlan;
  queryStore?: QueryStore;
  root: QueryBindingRoot;
}

/** Runtime API used by generated runtime integration. */
export interface ClockScheduler {
  dispose(): void;
  install(
    root: QueryBindingRoot,
    plans: readonly ClockUpdatePlan[],
    context?: ClockUpdateContext,
  ): () => void;
}

/** Runtime API used by generated runtime integration. */
export interface ClockSchedulerEventTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener?: (type: string, listener: (event: Event) => void) => void;
  visibilityState?: 'hidden' | 'visible';
}

/** Runtime API used by generated runtime integration. */
export interface ClockSchedulerOptions {
  ownerDocument?: ClockSchedulerEventTarget | undefined;
}

/** Runtime API used by generated runtime integration. */
export interface InstallClockUpdatePlansOptions extends ClockSchedulerOptions {
  scheduler?: ClockScheduler;
}

/** Runtime API used by generated runtime integration. */
export function installClockUpdatePlans(
  root: QueryBindingRoot,
  plans: readonly ClockUpdatePlan[],
  context: ClockUpdateContext = {},
  options: InstallClockUpdatePlansOptions = {},
): () => void {
  const scheduler =
    options.scheduler ??
    createClockScheduler({ ownerDocument: options.ownerDocument ?? clockOwnerDocument(root) });
  const dispose = scheduler.install(root, plans, context);

  if (options.scheduler) return dispose;

  return () => {
    dispose();
    scheduler.dispose();
  };
}

/** Runtime API used by generated runtime integration. */
export function createClockScheduler(options: ClockSchedulerOptions = {}): ClockScheduler {
  return new DefaultClockScheduler(options.ownerDocument);
}

class DefaultClockScheduler implements ClockScheduler {
  private framePending = false;
  private readonly subscriptions = new Set<ClockSubscription>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private visibilityListenerAttached = false;
  private readonly visibilityTarget: ClockSchedulerEventTarget | undefined;

  constructor(visibilityTarget?: ClockSchedulerEventTarget) {
    this.visibilityTarget = visibilityTarget;
  }

  dispose(): void {
    this.subscriptions.clear();
    this.restartTimer();
    this.framePending = false;
    this.detachVisibilityListeners();
  }

  install(
    root: QueryBindingRoot,
    plans: readonly ClockUpdatePlan[],
    context: ClockUpdateContext = {},
  ): () => void {
    const activePlans = plans.filter((plan) => tickingClockEntries(plan).length > 0);
    if (activePlans.length === 0) return () => {};

    const now = Date.now();
    const installed = activePlans.map((plan) => ({
      nextDue: initialDueTimes(plan, now),
      plan,
      ...(context.queryStore ? { queryStore: context.queryStore } : {}),
      root,
    }));

    for (const subscription of installed) this.subscriptions.add(subscription);
    this.attachVisibilityListeners();
    this.scheduleClockFrame();
    this.restartTimer();

    return () => {
      for (const subscription of installed) this.subscriptions.delete(subscription);
      this.restartTimer();
      if (this.subscriptions.size === 0) this.detachVisibilityListeners();
    };
  }

  private readonly onVisibilityChange = (): void => {
    const target = this.visibilityTarget;
    if (!target || target.visibilityState === undefined || target.visibilityState === 'visible') {
      this.scheduleClockFrame();
    }
  };

  private attachVisibilityListeners(): void {
    if (!this.visibilityTarget || this.visibilityListenerAttached) return;

    // K7 / SPEC freshness: when the page returns from the background the interval
    // and rAF may not have fired since the last visible state, so relative-time
    // labels stay stale. Drive an immediate catch-up frame on visibility restore.
    this.visibilityTarget.addEventListener('visibilitychange', this.onVisibilityChange);
    this.visibilityTarget.addEventListener('pageshow', this.onVisibilityChange);
    this.visibilityListenerAttached = true;
  }

  private detachVisibilityListeners(): void {
    if (!this.visibilityTarget || !this.visibilityListenerAttached) return;

    this.visibilityTarget.removeEventListener?.('visibilitychange', this.onVisibilityChange);
    this.visibilityTarget.removeEventListener?.('pageshow', this.onVisibilityChange);
    this.visibilityListenerAttached = false;
  }

  private restartTimer(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    const interval = this.shortestIntervalMs();
    if (interval === null) return;

    this.timer = setInterval(() => this.scheduleClockFrame(), interval);
  }

  private shortestIntervalMs(): number | null {
    let interval: number | null = null;

    for (const subscription of this.subscriptions) {
      for (const [, spec] of tickingClockEntries(subscription.plan)) {
        const every = intervalMs(spec.every);
        if (every === null) continue;
        interval = interval === null ? every : Math.min(interval, every);
      }
    }

    return interval;
  }

  private scheduleClockFrame(): void {
    if (this.framePending) return;
    this.framePending = true;

    const requestFrame = globalThis.requestAnimationFrame;
    if (typeof requestFrame === 'function') {
      requestFrame(() => this.runClockFrame());
    } else {
      setTimeout(() => this.runClockFrame(), 0);
    }
  }

  private runClockFrame(): void {
    this.framePending = false;
    const current = Date.now();

    for (const subscription of this.subscriptions) {
      const now = dueClockValues(subscription, current);
      if (Object.keys(now).length === 0) continue;
      subscription.queryStore?.set('now', now);
      subscription.plan.update(
        subscription.root,
        now,
        subscription.queryStore ? { queryStore: subscription.queryStore } : {},
      );
    }
  }
}

function initialDueTimes(plan: ClockUpdatePlan, now: number): Map<string, number> {
  const dueTimes = new Map<string, number>();
  for (const [name] of tickingClockEntries(plan)) dueTimes.set(name, now);
  return dueTimes;
}

function dueClockValues(subscription: ClockSubscription, current: number): Record<string, Date> {
  const now: Record<string, Date> = {};

  for (const [name, spec] of tickingClockEntries(subscription.plan)) {
    const every = intervalMs(spec.every);
    if (every === null) continue;

    const due = subscription.nextDue.get(name) ?? current;
    if (current < due) continue;

    now[name] = new Date(current);
    subscription.nextDue.set(name, current + every);
  }

  return now;
}

function tickingClockEntries(plan: ClockUpdatePlan): Array<[string, ClockUpdateSpec]> {
  return Object.entries(plan.clocks).filter(
    (entry): entry is [string, ClockUpdateSpec] =>
      entry[1] !== undefined && entry[1].renderOnce !== true && intervalMs(entry[1].every) !== null,
  );
}

function intervalMs(value: ClockUpdateSpec['every']): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;

  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(value.trim());
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2] ?? 'ms';
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return amount * ({ h: 3_600_000, m: 60_000, ms: 1, s: 1_000 }[unit] ?? 1);
}

function clockOwnerDocument(root: QueryBindingRoot): ClockSchedulerEventTarget | undefined {
  const maybeRoot = root as QueryBindingRoot & {
    addEventListener?: ClockSchedulerEventTarget['addEventListener'];
    ownerDocument?: ClockSchedulerEventTarget;
    visibilityState?: ClockSchedulerEventTarget['visibilityState'];
  };

  if (maybeRoot.ownerDocument) return maybeRoot.ownerDocument;
  if (typeof maybeRoot.addEventListener === 'function') {
    return maybeRoot as ClockSchedulerEventTarget;
  }
  return undefined;
}
