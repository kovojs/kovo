import { renderStylesheetLinks } from './hints.js';
import type { StylesheetAsset } from './hints.js';
import { escapeAttribute, escapeHtml } from './html.js';

export interface DeferredQueryChunk {
  key?: string;
  name: string;
  value: unknown;
}

export type DeferredPriority = 'high' | 'normal' | 'low' | number;

export interface DeferredFragmentChunk {
  html: string;
  mode?: 'append' | 'replace';
  priority?: DeferredPriority;
  stylesheets?: readonly (string | StylesheetAsset)[];
  target: string;
}

export interface DeferredStreamOptions {
  boundary?: string;
  chunks: readonly DeferredStreamChunk[];
  closeHtml?: string;
  shell: string;
}

export interface DeferredStreamChunk {
  fragments: readonly DeferredFragmentChunk[];
  priority?: DeferredPriority;
  queries?: readonly DeferredQueryChunk[];
}

export interface DeferredStreamResponse {
  body: string;
  headers: Record<string, string>;
  status: 200;
}

export function renderDeferredStream(options: DeferredStreamOptions): DeferredStreamResponse {
  const boundary = options.boundary ?? 'jiso-boundary';
  const chunks = sortDeferredChunks(options.chunks).map((chunk) =>
    [
      `--${boundary}`,
      ...renderDeferredQueryChunks(chunk.queries ?? []),
      ...sortDeferredFragments(chunk.fragments).map(renderDeferredFragmentChunk),
    ].join('\n'),
  );

  return {
    body: [options.shell, ...chunks, `--${boundary}--`, options.closeHtml ?? ''].join('\n'),
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Transfer-Encoding': 'chunked',
    },
    status: 200,
  };
}

function renderDeferredFragmentChunk(fragment: DeferredFragmentChunk): string {
  const priority =
    fragment.priority !== undefined
      ? ` priority="${escapeAttribute(String(fragment.priority))}"`
      : '';
  const mode = fragment.mode === 'append' ? ' mode="append"' : '';
  const stylesheets = renderStylesheetLinks(fragment.stylesheets ?? []);

  return `<fw-fragment target="${escapeAttribute(fragment.target)}"${mode}${priority}>${stylesheets}${fragment.html}</fw-fragment>`;
}

function renderDeferredQueryChunks(queries: readonly DeferredQueryChunk[]): string[] {
  return queries.map((queryChunk) => {
    const key = queryChunk.key ? ` key="${escapeAttribute(queryChunk.key)}"` : '';
    return `<fw-query name="${escapeAttribute(queryChunk.name)}"${key}>${escapeHtml(JSON.stringify(queryChunk.value))}</fw-query>`;
  });
}

function sortDeferredChunks(chunks: readonly DeferredStreamChunk[]): DeferredStreamChunk[] {
  return stablePrioritySort(chunks, (chunk) => chunk.priority);
}

function sortDeferredFragments(
  fragments: readonly DeferredFragmentChunk[],
): DeferredFragmentChunk[] {
  return stablePrioritySort(fragments, (fragment) => fragment.priority);
}

function stablePrioritySort<Value>(
  values: readonly Value[],
  priorityFor: (value: Value) => DeferredPriority | undefined,
): Value[] {
  return values
    .map((value, index) => ({ index, priority: priorityRank(priorityFor(value)), value }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index)
    .map((entry) => entry.value);
}

function priorityRank(priority: DeferredPriority | undefined): number {
  if (typeof priority === 'number') return priority;

  switch (priority) {
    case 'high':
      return 1;
    case 'low':
      return -1;
    case 'normal':
    case undefined:
      return 0;
  }
}
