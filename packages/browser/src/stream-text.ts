import type { StreamTextChunk } from './wire-response-scanner.js';
import type { ImportHandlerModule } from './handlers.js';
import { assertAllowedKovoDynamicImportUrl } from './dynamic-import-url.js';

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
    applied.push(chunk.target);
  }

  return applied;
}

export class StreamTextBuffer {
  private readonly flushDelayMs: number;
  private readonly flushThreshold: number;
  private readonly importModule: ImportHandlerModule | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly pendingFlushes = new Set<Promise<void>>();
  private readonly signal: AbortSignal | undefined;
  private readonly states = new Map<string, StreamTextState>();

  constructor(options: StreamTextBufferOptions = {}) {
    this.flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
    this.flushThreshold = options.flushThreshold ?? DEFAULT_FLUSH_THRESHOLD;
    this.importModule = options.importModule;
    this.onError = options.onError;
    this.signal = options.signal;
  }

  push(root: StreamTextRoot, chunk: StreamTextChunk): boolean {
    if (this.signal?.aborted) {
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
    await Promise.all(this.pendingFlushes);
    const targets = [...this.states.keys()];
    await Promise.all(targets.map((target) => this.flushTarget(target, reason)));
    await Promise.all(this.pendingFlushes);
  }

  async fail(error: unknown): Promise<void> {
    await this.flush('error');
    for (const state of this.states.values()) {
      state.target.setAttribute?.('data-stream-state', 'error');
    }
    this.onError?.(error);
  }

  private stateFor(targetName: string, target: StreamTextTarget): StreamTextState {
    const existing = this.states.get(targetName);
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
    this.states.set(targetName, state);
    return state;
  }

  private async flushTarget(
    targetName: string,
    reason: 'checkpoint' | 'completion' | 'error' | 'threshold' | 'timer',
  ): Promise<void> {
    const state = this.states.get(targetName);
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
    const flush = this.flushTarget(targetName, reason).finally(() => {
      this.pendingFlushes.delete(flush);
    });
    this.pendingFlushes.add(flush);
  }

  private async render(target: StreamTextTarget, source: string): Promise<void> {
    const ref = target.getAttribute?.('data-stream-renderer');
    if (!ref || !this.importModule) return;

    const parsed = parseRendererReference(ref);
    if (!parsed) {
      this.onError?.(new Error(`Invalid data-stream-renderer reference: ${ref}`));
      return;
    }

    try {
      assertAllowedKovoDynamicImportUrl(parsed.url);
      const mod = await this.importModule(parsed.url);
      const renderer = mod[parsed.exportName];
      if (typeof renderer !== 'function') {
        this.onError?.(new Error(`Stream renderer export not found: ${ref}`));
        return;
      }
      await renderer(target, source, { signal: this.signal });
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
  const hashIndex = value.lastIndexOf('#');
  if (hashIndex <= 0 || hashIndex === value.length - 1) return null;

  return {
    exportName: value.slice(hashIndex + 1),
    url: value.slice(0, hashIndex),
  };
}

function escapeCssString(value: string): string {
  return value.replace(/[\n\r\f"\\]/g, (char) => {
    if (char === '\n') return '\\a ';
    if (char === '\r') return '\\d ';
    if (char === '\f') return '\\c ';
    return `\\${char}`;
  });
}

function abortError(): Error {
  try {
    return new DOMException('Streaming mutation text aborted', 'AbortError');
  } catch {
    return new Error('Streaming mutation text aborted');
  }
}
