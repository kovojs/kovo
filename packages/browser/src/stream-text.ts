import type { StreamTextChunk } from './wire-response-scanner.js';
import type { ImportHandlerModule } from './handlers.js';
import { assertAllowedKovoDynamicImportUrlForModule } from './dynamic-import-url.js';
import {
  applySecurityIntrinsic,
  securityArrayAppend,
  securityGetOwnPropertyDescriptor,
  securityMap,
  securityMapForEach,
  securityMapGet,
  securityMapSet,
  securitySet,
  securitySetAdd,
  securitySetDelete,
  securitySetForEach,
  securityStringSlice,
} from './security-witness-intrinsics.js';
import { readRuntimeElementAttribute } from './runtime-dom-security.js';

export interface StreamTextTarget {
  getAttribute?(name: string): string | null;
  setAttribute?(name: string, value: string): void;
  textContent: string | null;
}

export interface StreamTextRoot {
  findStreamTextTarget?(target: string): StreamTextTarget | null;
  querySelector?(selector: string): Element | null;
  querySelectorAll?(selector: string): Iterable<StreamTextTarget>;
}

export interface ApplyStreamTextOptions {
  buffer?: StreamTextBuffer;
  onError?: (error: unknown) => void;
}

export interface StreamTextBufferOptions {
  flushDelayMs?: number;
  flushThreshold?: number;
  importModule?: ImportHandlerModule;
  onError?: (error: unknown) => void;
  signal?: AbortSignal;
}

interface StreamTextState {
  accumulated: string;
  pending: string;
  target: StreamTextTarget;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const DEFAULT_FLUSH_DELAY_MS = 25;
const DEFAULT_FLUSH_THRESHOLD = 1024;
const StreamTextAbortController = globalThis.AbortController;
const StreamTextAbortSignal = globalThis.AbortSignal;
const StreamTextTypeError = globalThis.TypeError;
const streamTextAbort = securityGetOwnPropertyDescriptor(
  StreamTextAbortController.prototype,
  'abort',
)?.value;
const streamTextSignal = securityGetOwnPropertyDescriptor(
  StreamTextAbortController.prototype,
  'signal',
)?.get;
const streamTextSignalAborted = securityGetOwnPropertyDescriptor(
  StreamTextAbortSignal.prototype,
  'aborted',
)?.get;
const streamTextAbortControlsSound = verifyStreamTextAbortControls();

export function applyStreamTextChunks(
  root: StreamTextRoot | undefined,
  chunks: readonly StreamTextChunk[] | undefined,
  options: ApplyStreamTextOptions = {},
): string[] {
  if (!root || chunks === undefined || chunks.length === 0) return [];

  const applied: string[] = [];
  for (const chunk of chunks) {
    if (options.buffer) {
      if (!options.buffer.push(root, chunk)) continue;
    } else if (!applyStreamTextChunkImmediately(root, chunk, options.onError)) {
      continue;
    }
    securityArrayAppend(applied, chunk.target, 'Kovo stream-text applied targets');
  }

  return applied;
}

export class StreamTextBuffer {
  private readonly flushDelayMs: number;
  private readonly flushThreshold: number;
  private readonly importModule: ImportHandlerModule | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly pendingFlushes = securitySet<Promise<void>>();
  private readonly signal: AbortSignal | undefined;
  private readonly states = securityMap<string, StreamTextState>();

  constructor(options: StreamTextBufferOptions = {}) {
    this.flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
    this.flushThreshold = options.flushThreshold ?? DEFAULT_FLUSH_THRESHOLD;
    this.importModule = options.importModule;
    this.onError = options.onError;
    this.signal = options.signal;
  }

  push(root: StreamTextRoot, chunk: StreamTextChunk): boolean {
    if (this.signal && readStreamTextSignalAborted(this.signal)) {
      this.onError?.(abortError());
      return false;
    }

    const target = findStreamTextTarget(root, chunk.target);
    if (!target) {
      this.onError?.(new Error(`Missing kovo-text target: ${chunk.target}`));
      return false;
    }

    const state = this.stateFor(chunk.target, target);
    if (chunk.mode === 'checkpoint') {
      state.accumulated = chunk.text;
      state.pending = chunk.text;
      this.cancelTimer(state);
      this.scheduleFlush(chunk.target, 'checkpoint');
      return true;
    }

    state.accumulated += chunk.text;
    state.pending += chunk.text;
    target.setAttribute?.('data-stream-state', 'streaming');

    if (state.pending.length >= this.flushThreshold) {
      this.cancelTimer(state);
      this.scheduleFlush(chunk.target, 'threshold');
      return true;
    }

    if (!state.timer) {
      state.timer = setTimeout(() => {
        state.timer = undefined;
        this.scheduleFlush(chunk.target, 'timer');
      }, this.flushDelayMs);
    }

    return true;
  }

  async flush(reason: 'completion' | 'error' = 'completion'): Promise<void> {
    await this.drainPendingFlushes();
    const targets: string[] = [];
    securityMapForEach(this.states, (_state, target) => {
      securityArrayAppend(targets, target, 'Kovo stream-text flush targets');
    });
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      if (target !== undefined) await this.flushTarget(target, reason);
    }
    await this.drainPendingFlushes();
  }

  async fail(error: unknown): Promise<void> {
    await this.flush('error');
    securityMapForEach(this.states, (state) => {
      state.target.setAttribute?.('data-stream-state', 'error');
    });
    this.onError?.(error);
  }

  private stateFor(targetName: string, target: StreamTextTarget): StreamTextState {
    const existing = securityMapGet(this.states, targetName);
    if (existing) {
      existing.target = target;
      return existing;
    }

    const state: StreamTextState = {
      accumulated: target.textContent ?? '',
      pending: '',
      target,
      timer: undefined,
    };
    securityMapSet(this.states, targetName, state);
    return state;
  }

  private async flushTarget(
    targetName: string,
    reason: 'checkpoint' | 'completion' | 'error' | 'threshold' | 'timer',
  ): Promise<void> {
    const state = securityMapGet(this.states, targetName);
    // K6 / SPEC §9.1: a checkpoint with empty text must still flush and clear
    // textContent even if pending.length === 0, because "checkpoint replaces
    // accumulated source". Skip only non-checkpoint empty flushes.
    if (!state || (state.pending.length === 0 && reason !== 'checkpoint')) return;

    this.cancelTimer(state);
    state.pending = '';
    state.target.textContent = state.accumulated;
    state.target.setAttribute?.('data-stream-state', reason === 'error' ? 'error' : 'streaming');
    await this.render(state.target, state.accumulated);
  }

  private scheduleFlush(targetName: string, reason: 'checkpoint' | 'threshold' | 'timer'): void {
    const flushRecord: { value: Promise<void> | undefined } = { value: undefined };
    const flush = (async () => {
      try {
        await this.flushTarget(targetName, reason);
      } finally {
        if (flushRecord.value !== undefined) {
          securitySetDelete(this.pendingFlushes, flushRecord.value);
        }
      }
    })();
    flushRecord.value = flush;
    securitySetAdd(this.pendingFlushes, flush);
  }

  private async drainPendingFlushes(): Promise<void> {
    // A renderer may schedule another flush while an earlier one settles. Drain to quiescence so
    // no renderer continuation escapes after a confirmed/failing mutation response returns.
    for (let round = 0; round < 100_000; round += 1) {
      const pending: Promise<void>[] = [];
      securitySetForEach(this.pendingFlushes, (flush) => {
        securityArrayAppend(pending, flush, 'Kovo stream-text pending flushes');
      });
      if (pending.length === 0) return;
      for (let index = 0; index < pending.length; index += 1) {
        const flush = pending[index];
        if (flush !== undefined) await flush;
      }
    }
    throw new TypeError('Kovo stream-text flush queue did not quiesce.');
  }

  private async render(target: StreamTextTarget, source: string): Promise<void> {
    const ref = readRuntimeElementAttribute(target, 'data-stream-renderer');
    if (!ref || !this.importModule) return;

    const parsed = parseRendererReference(ref);
    if (!parsed) {
      this.onError?.(new Error(`Invalid data-stream-renderer reference: ${ref}`));
      return;
    }

    try {
      assertAllowedKovoDynamicImportUrlForModule(parsed.url, this.importModule);
      const mod = await this.importModule(parsed.url);
      const descriptor = securityGetOwnPropertyDescriptor(mod, parsed.exportName);
      const renderer = descriptor && 'value' in descriptor ? descriptor.value : undefined;
      if (!isStreamRenderer(renderer)) {
        this.onError?.(new Error(`Stream renderer export not found: ${ref}`));
        return;
      }
      await applySecurityIntrinsic<unknown>(renderer, undefined, [
        target,
        source,
        { signal: this.signal },
      ]);
    } catch (error) {
      this.onError?.(error);
    }
  }

  private cancelTimer(state: StreamTextState): void {
    if (!state.timer) return;
    clearTimeout(state.timer);
    state.timer = undefined;
  }
}

function readStreamTextSignalAborted(signal: AbortSignal): boolean {
  if (!streamTextAbortControlsSound || typeof streamTextSignalAborted !== 'function') {
    throw new StreamTextTypeError(
      'Kovo stream-text AbortSignal controls are unavailable because realm intrinsics were modified before runtime initialization.',
    );
  }
  const aborted = applySecurityIntrinsic<unknown>(streamTextSignalAborted, signal, []);
  if (typeof aborted !== 'boolean') {
    throw new StreamTextTypeError('Kovo stream-text AbortSignal state is unavailable.');
  }
  return aborted;
}

function verifyStreamTextAbortControls(): boolean {
  if (
    typeof StreamTextAbortController !== 'function' ||
    typeof StreamTextAbortSignal !== 'function' ||
    typeof streamTextAbort !== 'function' ||
    typeof streamTextSignal !== 'function' ||
    typeof streamTextSignalAborted !== 'function'
  ) {
    return false;
  }
  try {
    const controller = new StreamTextAbortController();
    const signal = applySecurityIntrinsic<unknown>(streamTextSignal, controller, []);
    if (
      signal === null ||
      typeof signal !== 'object' ||
      applySecurityIntrinsic<unknown>(streamTextSignalAborted, signal, []) !== false
    ) {
      return false;
    }
    applySecurityIntrinsic(streamTextAbort, controller, []);
    if (applySecurityIntrinsic<unknown>(streamTextSignalAborted, signal, []) !== true) return false;
    let rejectedForeignReceiver = false;
    try {
      applySecurityIntrinsic(streamTextSignalAborted, {}, []);
    } catch {
      rejectedForeignReceiver = true;
    }
    return rejectedForeignReceiver;
  } catch {
    return false;
  }
}

function isStreamRenderer(
  value: unknown,
): value is (
  target: StreamTextTarget,
  source: string,
  options: { signal: AbortSignal | undefined },
) => unknown {
  return typeof value === 'function';
}

export function findStreamTextTarget(
  root: StreamTextRoot,
  target: string,
): StreamTextTarget | null {
  const resolved = root.findStreamTextTarget?.(target);
  if (resolved) return resolved;

  const selector = `[data-stream-text="${escapeCssString(target)}"]`;
  const queryOne = root.querySelector?.(selector);
  if (queryOne) return queryOne;

  if (!root.querySelectorAll) return null;
  for (const candidate of root.querySelectorAll(selector)) {
    return candidate;
  }

  return null;
}

function applyStreamTextChunkImmediately(
  root: StreamTextRoot,
  chunk: StreamTextChunk,
  onError: ((error: unknown) => void) | undefined,
): boolean {
  const target = findStreamTextTarget(root, chunk.target);
  if (!target) {
    onError?.(new Error(`Missing kovo-text target: ${chunk.target}`));
    return false;
  }

  const current = target.textContent ?? '';
  target.textContent = chunk.mode === 'checkpoint' ? chunk.text : `${current}${chunk.text}`;
  target.setAttribute?.('data-stream-state', 'streaming');
  return true;
}

function parseRendererReference(value: string): { exportName: string; url: string } | null {
  let hashIndex = -1;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] === '#') {
      hashIndex = index;
      break;
    }
  }
  if (hashIndex <= 0 || hashIndex === value.length - 1) return null;

  return {
    exportName: securityStringSlice(value, hashIndex + 1),
    url: securityStringSlice(value, 0, hashIndex),
  };
}

function escapeCssString(value: string): string {
  let escaped = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (character === '\n') escaped += '\\a ';
    else if (character === '\r') escaped += '\\d ';
    else if (character === '\f') escaped += '\\c ';
    else if (character === '"' || character === '\\') escaped += `\\${character}`;
    else escaped += character;
  }
  return escaped;
}

function abortError(): Error {
  try {
    return new DOMException('Streaming mutation text aborted', 'AbortError');
  } catch {
    return new Error('Streaming mutation text aborted');
  }
}
