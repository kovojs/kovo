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

const subscriptions = new Set<ClockSubscription>();
let timer: ReturnType<typeof setInterval> | undefined;
let framePending = false;

/** Runtime API used by generated runtime integration. */
export function installClockUpdatePlans(
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

  for (const subscription of installed) subscriptions.add(subscription);
  scheduleClockFrame();
  restartTimer();

  return () => {
    for (const subscription of installed) subscriptions.delete(subscription);
    restartTimer();
  };
}

function initialDueTimes(plan: ClockUpdatePlan, now: number): Map<string, number> {
  const dueTimes = new Map<string, number>();
  for (const [name] of tickingClockEntries(plan)) dueTimes.set(name, now);
  return dueTimes;
}

function restartTimer(): void {
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }

  const interval = shortestIntervalMs();
  if (interval === null) return;

  timer = setInterval(scheduleClockFrame, interval);
}

function shortestIntervalMs(): number | null {
  let interval: number | null = null;

  for (const subscription of subscriptions) {
    for (const [, spec] of tickingClockEntries(subscription.plan)) {
      const every = intervalMs(spec.every);
      if (every === null) continue;
      interval = interval === null ? every : Math.min(interval, every);
    }
  }

  return interval;
}

function scheduleClockFrame(): void {
  if (framePending) return;
  framePending = true;

  const requestFrame = globalThis.requestAnimationFrame;
  if (typeof requestFrame === 'function') {
    requestFrame(() => runClockFrame());
  } else {
    setTimeout(runClockFrame, 0);
  }
}

function runClockFrame(): void {
  framePending = false;
  const current = Date.now();

  for (const subscription of subscriptions) {
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
