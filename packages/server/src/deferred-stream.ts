import type { StylesheetAsset } from './hints.js';
import type { ServerResponseBase } from './response.js';
import { renderFragmentWireHtml, renderQueryWireHtml } from './wire-html.js';

/** @internal */
export interface DeferredQueryChunk {
  key?: string;
  name: string;
  value: unknown;
}

/** @internal */
export type DeferredPriority = 'high' | 'normal' | 'low' | number;

/** @internal */
export interface DeferredFragmentChunk {
  html: string;
  mode?: 'append' | 'replace';
  priority?: DeferredPriority;
  stylesheets?: readonly (string | StylesheetAsset)[];
  target: string;
}

/** @internal */
export interface DeferredStreamOptions {
  boundary?: string;
  chunks: readonly DeferredStreamChunk[];
  closeHtml?: string;
  shell: string;
}

/** @internal */
export interface DeferredStreamChunk {
  fragments: readonly DeferredFragmentChunk[];
  priority?: DeferredPriority;
  queries?: readonly DeferredQueryChunk[];
}

/** @internal */
export interface DeferredStreamResponse extends ServerResponseBase<
  string,
  Record<string, string>,
  200
> {}

const deferredChunkApplyScript =
  '<script>let s=document.currentScript,n=s.previousSibling,e=[];for(;n;){let p=n.previousSibling,t=n.textContent||"";if(n.outerHTML)e.unshift(n.outerHTML);n.remove();if(t.includes("--kovo-boundary"))break;n=p}globalThis.__kovo_a?.(e.join("\\n"));s.remove()</script>';
const deferredCloseCleanupScript =
  '<script>for(const n of [...document.body.childNodes])if((n.textContent||"").includes("--kovo-boundary"))n.remove();document.currentScript.remove()</script>';

/**
 * Render the framework's deferred fragment stream payload.
 *
 * @internal
 */
export function renderDeferredStream(options: DeferredStreamOptions): DeferredStreamResponse {
  const boundary = options.boundary ?? 'kovo-boundary';
  const chunks = sortDeferredChunks(options.chunks).map((chunk) =>
    [
      `--${boundary}`,
      ...renderDeferredQueryChunks(chunk.queries ?? []),
      ...sortDeferredFragments(chunk.fragments).map(renderDeferredFragmentChunk),
      deferredChunkApplyScript,
    ].join('\n'),
  );

  return {
    body: [
      options.shell,
      ...chunks,
      `--${boundary}--`,
      deferredCloseCleanupScript,
      options.closeHtml ?? '',
    ].join('\n'),
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
    status: 200,
  };
}

function renderDeferredFragmentChunk(fragment: DeferredFragmentChunk): string {
  return renderFragmentWireHtml({
    html: fragment.html,
    mode: fragment.mode,
    priority: fragment.priority,
    stylesheets: fragment.stylesheets,
    target: fragment.target,
  });
}

function renderDeferredQueryChunks(queries: readonly DeferredQueryChunk[]): string[] {
  return queries.map((queryChunk) =>
    renderQueryWireHtml({
      key: queryChunk.key || undefined,
      name: queryChunk.name,
      value: queryChunk.value,
    }),
  );
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
