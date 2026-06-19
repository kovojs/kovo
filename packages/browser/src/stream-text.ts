import type { StreamTextChunk } from './wire-response-scanner.js';

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
  onError?: (error: unknown) => void;
}

export function applyStreamTextChunks(
  root: StreamTextRoot | undefined,
  chunks: readonly StreamTextChunk[] | undefined,
  options: ApplyStreamTextOptions = {},
): string[] {
  if (!root || chunks === undefined || chunks.length === 0) return [];

  const applied: string[] = [];
  for (const chunk of chunks) {
    const target = findStreamTextTarget(root, chunk.target);
    if (!target) {
      options.onError?.(new Error(`Missing kovo-text target: ${chunk.target}`));
      continue;
    }

    const current = target.textContent ?? '';
    target.textContent = chunk.mode === 'checkpoint' ? chunk.text : `${current}${chunk.text}`;
    target.setAttribute?.('data-stream-state', 'streaming');
    applied.push(chunk.target);
  }

  return applied;
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

function escapeCssString(value: string): string {
  return value.replace(/[\n\r\f"\\]/g, (char) => {
    if (char === '\n') return '\\a ';
    if (char === '\r') return '\\d ';
    if (char === '\f') return '\\c ';
    return `\\${char}`;
  });
}
