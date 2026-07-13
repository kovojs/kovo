import {
  applySecurityIntrinsic,
  defineSecurityProperties,
  securityArrayAppend,
  securityGetOwnPropertyDescriptor,
  securityMap,
  securityMapDelete,
  securityMapGet,
  securityMapSet,
  securityOwnArrayEntry,
} from './security-witness-intrinsics.js';

const MutationQueuePromise = Promise;
const MutationQueueAbortController = AbortController;
const MutationQueueError = Error;
const mutationQueueAbort = securityGetOwnPropertyDescriptor(
  MutationQueueAbortController.prototype,
  'abort',
)?.value;
const mutationQueueSignal = securityGetOwnPropertyDescriptor(
  MutationQueueAbortController.prototype,
  'signal',
)?.get;
const mutationQueueSetTimeout = globalThis.setTimeout;
const mutationQueueClearTimeout = globalThis.clearTimeout;
const mutationQueueNumberIsFinite = Number.isFinite;

/** @internal A queued mutation task: a thunk returning a value or promise (SPEC §10.4). */
export type MutationTask<Value> = (signal: AbortSignal) => Promise<Value> | Value;

/** @internal Options for a named mutation queue (SPEC §10.4). */
export interface MutationQueueOptions {
  maxDepth?: number;
  timeoutMs?: number;
}

/** @internal Per-entry hooks for a queued mutation task (SPEC §10.4). */
export interface MutationQueueRunOptions {
  onTimeout?: (error: Error) => void;
}

interface MutationQueueEntry<Value = unknown> {
  controller: AbortController;
  finished: boolean;
  onTimeout?: (error: Error) => void;
  onTimeoutReceiver?: object;
  queue: string;
  reject: (error: unknown) => void;
  resolve: (value: Value) => void;
  signal: AbortSignal;
  task: MutationTask<Value>;
  timer?: ReturnType<typeof setTimeout>;
}

/** @internal Serializes optimistic mutations per named queue so they apply in order (SPEC §10.4). */
export class MutationQueue {
  #maxDepth: number;
  #queues = securityMap<string, MutationQueueEntry[]>();
  #timeoutMs: number;

  constructor(options: MutationQueueOptions = {}) {
    const maxDepth = mutationQueueOwnOption(options, 'maxDepth', 'Kovo mutation queue maxDepth');
    const timeoutMs = mutationQueueOwnOption(options, 'timeoutMs', 'Kovo mutation queue timeoutMs');
    this.#maxDepth = boundedMutationQueueNumber(maxDepth, 32, 1, 100_000, 'maxDepth');
    this.#timeoutMs = boundedMutationQueueNumber(timeoutMs, 30_000, 0, 2_147_483_647, 'timeoutMs');
  }

  assertCanEnqueue(queue: string | undefined): void {
    if (!queue) return;

    const depth = this.depth(queue);
    if (depth >= this.#maxDepth) {
      throw new Error(`Mutation queue "${queue}" exceeded its maximum depth of ${this.#maxDepth}.`);
    }
  }

  depth(queue: string): number {
    return securityMapGet(this.#queues, queue)?.length ?? 0;
  }

  run<Value>(
    queue: string | undefined,
    task: MutationTask<Value>,
    options: MutationQueueRunOptions = {},
  ): Promise<Value> {
    if (!queue) {
      const controller = createMutationQueueAbortController();
      const signal = readMutationQueueAbortSignal(controller);
      return (async () => {
        // Preserve the queue's always-async task-start contract without dispatching through the
        // mutable global Promise.resolve/then surface.
        await undefined;
        return await task(signal);
      })();
    }

    this.assertCanEnqueue(queue);
    const onTimeout = mutationQueueOwnOption(options, 'onTimeout', 'Kovo mutation queue onTimeout');
    if (onTimeout !== undefined && typeof onTimeout !== 'function') {
      throw new TypeError('Kovo mutation queue onTimeout must be a function.');
    }

    return new MutationQueuePromise<Value>((resolve, reject) => {
      const controller = createMutationQueueAbortController();
      const entry: MutationQueueEntry<Value> = {
        controller,
        finished: false,
        ...(onTimeout ? { onTimeout, onTimeoutReceiver: options } : {}),
        queue,
        reject,
        resolve,
        signal: readMutationQueueAbortSignal(controller),
        task,
      };
      const entries = securityMapGet(this.#queues, queue) ?? [];
      securityArrayAppend(
        entries,
        entry as MutationQueueEntry,
        'Browser named mutation queue entries',
      );
      securityMapSet(this.#queues, queue, entries);
      if (entries.length === 1) {
        this.#start(entry);
      }
    });
  }

  pending(queue: string): boolean {
    return this.depth(queue) > 0;
  }

  #start<Value>(entry: MutationQueueEntry<Value>): void {
    if (this.#timeoutMs > 0 && mutationQueueNumberIsFinite(this.#timeoutMs)) {
      entry.timer = applySecurityIntrinsic<ReturnType<typeof setTimeout>>(
        mutationQueueSetTimeout,
        globalThis,
        [
          () => {
            const error = new MutationQueueError(
              `Mutation queue "${entry.queue}" head timed out after ${this.#timeoutMs}ms.`,
            );
            defineSecurityProperties(error, {
              name: {
                configurable: true,
                enumerable: false,
                value: 'AbortError',
                writable: true,
              },
            });
            if (typeof mutationQueueAbort !== 'function') {
              throw new TypeError('Kovo mutation queue AbortController control is unavailable.');
            }
            applySecurityIntrinsic(mutationQueueAbort, entry.controller, [error]);
            const onTimeout = securityGetOwnPropertyDescriptor(entry, 'onTimeout');
            if (onTimeout && 'value' in onTimeout && typeof onTimeout.value === 'function') {
              const receiver = securityGetOwnPropertyDescriptor(entry, 'onTimeoutReceiver');
              try {
                applySecurityIntrinsic(
                  onTimeout.value,
                  receiver && 'value' in receiver ? receiver.value : undefined,
                  [error],
                );
              } catch {
                // An application timeout observer cannot suppress abort/queue advancement.
              }
            }
            this.#finish(entry, { error });
          },
          this.#timeoutMs,
        ],
      );
    }

    void (async () => {
      await undefined;
      try {
        const value = await entry.task(entry.signal);
        this.#finish(entry, { value });
      } catch (error) {
        this.#finish(entry, { error });
      }
    })();
  }

  #finish<Value>(
    entry: MutationQueueEntry<Value>,
    outcome: { error: unknown } | { value: Value },
  ): void {
    if (entry.finished) return;

    entry.finished = true;
    if (entry.timer !== undefined) {
      applySecurityIntrinsic(mutationQueueClearTimeout, globalThis, [entry.timer]);
    }

    const entries = securityMapGet(this.#queues, entry.queue) ?? [];
    const survivors: MutationQueueEntry[] = [];
    let index = -1;
    for (let candidateIndex = 0; candidateIndex < entries.length; candidateIndex += 1) {
      const candidate = securityOwnArrayEntry(entries, candidateIndex);
      if (!candidate.ok) continue;
      if (candidate.value === entry) {
        index = candidateIndex;
        continue;
      }
      securityArrayAppend(survivors, candidate.value, 'Browser named mutation queue survivors');
    }
    if (survivors.length === 0) {
      securityMapDelete(this.#queues, entry.queue);
    } else if (index === 0) {
      securityMapSet(this.#queues, entry.queue, survivors);
      const next = securityOwnArrayEntry(survivors, 0);
      if (next.ok) this.#start(next.value);
    } else {
      securityMapSet(this.#queues, entry.queue, survivors);
    }

    const error = securityGetOwnPropertyDescriptor(outcome, 'error');
    if (error && 'value' in error) entry.reject(error.value);
    else {
      const value = securityGetOwnPropertyDescriptor(outcome, 'value');
      if (!value || !('value' in value)) {
        entry.reject(new MutationQueueError('Kovo mutation queue outcome is invalid.'));
      } else entry.resolve(value.value as Value);
    }
  }
}

function createMutationQueueAbortController(): AbortController {
  return new MutationQueueAbortController();
}

function readMutationQueueAbortSignal(controller: AbortController): AbortSignal {
  if (typeof mutationQueueSignal !== 'function') {
    throw new TypeError('Kovo mutation queue AbortController signal control is unavailable.');
  }
  const signal = applySecurityIntrinsic<unknown>(mutationQueueSignal, controller, []);
  if (signal === null || typeof signal !== 'object') {
    throw new TypeError('Kovo mutation queue AbortController signal is invalid.');
  }
  return signal as AbortSignal;
}

function mutationQueueOwnOption(
  options: object,
  property: 'maxDepth' | 'onTimeout' | 'timeoutMs',
  label: string,
): unknown {
  const descriptor = securityGetOwnPropertyDescriptor(options, property);
  if (!descriptor) return undefined;
  if (!('value' in descriptor)) throw new TypeError(`${label} must be an own-data property.`);
  return descriptor.value;
}

function boundedMutationQueueNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'number' ||
    !mutationQueueNumberIsFinite(value) ||
    value % 1 !== 0 ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(
      `Kovo mutation queue ${label} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}
