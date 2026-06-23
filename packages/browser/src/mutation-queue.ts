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
  queue: string;
  reject: (error: unknown) => void;
  resolve: (value: Value) => void;
  task: MutationTask<Value>;
  timer?: ReturnType<typeof setTimeout>;
}

/** @internal Serializes optimistic mutations per named queue so they apply in order (SPEC §10.4). */
export class MutationQueue {
  #maxDepth: number;
  #queues = new Map<string, MutationQueueEntry[]>();
  #timeoutMs: number;

  constructor(options: MutationQueueOptions = {}) {
    this.#maxDepth = options.maxDepth ?? 32;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  assertCanEnqueue(queue: string | undefined): void {
    if (!queue) return;

    const depth = this.depth(queue);
    if (depth >= this.#maxDepth) {
      throw new Error(`Mutation queue "${queue}" exceeded its maximum depth of ${this.#maxDepth}.`);
    }
  }

  depth(queue: string): number {
    return this.#queues.get(queue)?.length ?? 0;
  }

  run<Value>(
    queue: string | undefined,
    task: MutationTask<Value>,
    options: MutationQueueRunOptions = {},
  ): Promise<Value> {
    if (!queue) {
      return Promise.resolve().then(() => task(new AbortController().signal));
    }

    this.assertCanEnqueue(queue);

    return new Promise<Value>((resolve, reject) => {
      const entry: MutationQueueEntry<Value> = {
        controller: new AbortController(),
        finished: false,
        ...(options.onTimeout ? { onTimeout: options.onTimeout } : {}),
        queue,
        reject,
        resolve,
        task,
      };
      const entries = this.#queues.get(queue) ?? [];
      entries.push(entry as MutationQueueEntry);
      this.#queues.set(queue, entries);
      if (entries.length === 1) {
        this.#start(entry);
      }
    });
  }

  pending(queue: string): boolean {
    return this.depth(queue) > 0;
  }

  #start<Value>(entry: MutationQueueEntry<Value>): void {
    if (this.#timeoutMs > 0 && Number.isFinite(this.#timeoutMs)) {
      entry.timer = setTimeout(() => {
        const error = new Error(
          `Mutation queue "${entry.queue}" head timed out after ${this.#timeoutMs}ms.`,
        );
        error.name = 'AbortError';
        entry.controller.abort(error);
        entry.onTimeout?.(error);
        this.#finish(entry, { error });
      }, this.#timeoutMs);
    }

    Promise.resolve()
      .then(() => entry.task(entry.controller.signal))
      .then(
        (value) => {
          this.#finish(entry, { value });
        },
        (error) => {
          this.#finish(entry, { error });
        },
      );
  }

  #finish<Value>(
    entry: MutationQueueEntry<Value>,
    outcome: { error: unknown } | { value: Value },
  ): void {
    if (entry.finished) return;

    entry.finished = true;
    if (entry.timer) clearTimeout(entry.timer);

    const entries = this.#queues.get(entry.queue) ?? [];
    const index = entries.indexOf(entry as MutationQueueEntry);
    if (index >= 0) entries.splice(index, 1);
    if (entries.length === 0) {
      this.#queues.delete(entry.queue);
    } else if (index === 0) {
      const next = entries[0];
      if (next) this.#start(next);
    }

    if ('error' in outcome) {
      entry.reject(outcome.error);
    } else {
      entry.resolve(outcome.value);
    }
  }
}
