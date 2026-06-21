import { cspHashAttribute, cspSha256, type CspInlineMetadata } from './csp.js';
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
> {
  /**
   * G1 (bugs-part3 CSP-1): CSP hashes for the inline apply/cleanup `<script>` blocks
   * emitted by the deferred stream (computed for the actual boundary). A strict
   * hash-CSP built from the framework's own hashes must include these or deferred
   * fragments/queries never apply. Callers merge this into the document's `csp`.
   */
  csp: CspInlineMetadata;
}

/**
 * Render the framework's deferred fragment stream payload.
 *
 * @internal
 */
export function renderDeferredStream(options: DeferredStreamOptions): DeferredStreamResponse {
  const boundary = options.boundary ?? 'kovo-boundary';
  // K8 / SPEC: the inline apply and cleanup scripts must reference the configurable
  // boundary, not the hardcoded 'kovo-boundary' literal. Interpolate `--${boundary}`
  // so non-default boundaries work correctly.
  //
  // G1 (bugs-part3 CSP-1): the script BODIES are hashed for CSP (the hash is computed
  // over the inline content, not the wrapping tag) and each `<script>` is stamped with
  // the matching `data-kovo-csp-hash` so a strict hash-CSP admits them; the hashes are
  // surfaced on `csp` so `renderDeferredDocument` merges them into `document.csp`.
  const applyScriptBody = `let s=document.currentScript,n=s.previousSibling,e=[];for(;n;){let p=n.previousSibling,t=n.textContent||"";if(n.outerHTML)e.unshift(n.outerHTML);n.remove();if(t.includes("--${boundary}"))break;n=p}globalThis.__kovo_a?.(e.join("\\n"));s.remove()`;
  const cleanupScriptBody = `for(const n of [...document.body.childNodes])if((n.textContent||"").includes("--${boundary}"))n.remove();document.currentScript.remove()`;
  const applyHash = cspSha256(applyScriptBody);
  const cleanupHash = cspSha256(cleanupScriptBody);
  const deferredChunkApplyScript = `<script ${cspHashAttribute(applyHash)}>${applyScriptBody}</script>`;
  const deferredCloseCleanupScript = `<script ${cspHashAttribute(cleanupHash)}>${cleanupScriptBody}</script>`;
  // SPEC §9:769 ("deferred query JSON is guaranteed to arrive before or with its
  // consumers") is held INTRA-CHUNK: each chunk emits its queries before its fragments,
  // and the canonical wire fixture enforces that a fragment ships in the same chunk as
  // the query it consumes. (Contested part-3 L2-deferred-3 proposed hoisting all queries
  // into a separate leading section to also cover a cross-chunk producer/consumer split;
  // that case does not occur under the co-location invariant, and global hoisting would
  // change the canonical wire byte layout — so it is intentionally not undertaken.)
  // L2-deferred-2 (bugs-part3): the client applies fragments in array order, so a
  // within-chunk priority sort would reorder same-target append/replace pairs (pagination
  // rows out of order, append-before-cleanup). Preserve author order INSIDE a chunk; only
  // chunk-level priority ordering remains (documented behavior).
  const chunks = sortDeferredChunks(options.chunks).map((chunk) =>
    [
      `--${boundary}`,
      ...renderDeferredQueryChunks(chunk.queries ?? []),
      ...chunk.fragments.map(renderDeferredFragmentChunk),
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
    // Dedupe: the apply hash repeats once per chunk but the CSP hash list is a set.
    csp: { scripts: [...new Set([applyHash, cleanupHash])], styles: [] },
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

function stablePrioritySort<Value>(
  values: readonly Value[],
  priorityFor: (value: Value) => DeferredPriority | undefined,
): Value[] {
  return values
    .map((value, index) => ({ index, priority: priorityRank(priorityFor(value)), value }))
    // L2-deferred-1 (bugs-part3): `right.priority - left.priority` is NaN-poisoned when
    // a priority is non-finite, making the comparator non-transitive (implementation-
    // defined order). `priorityRank` already coerces non-finite to the normal floor (0),
    // so the subtraction is always finite; the `|| index` tiebreak keeps it stable.
    .sort((left, right) => right.priority - left.priority || left.index - right.index)
    .map((entry) => entry.value);
}

function priorityRank(priority: DeferredPriority | undefined): number {
  // L2-deferred-1 (bugs-part3): coerce a non-finite numeric priority (NaN/±Infinity)
  // to the `normal` floor (0) so the comparator stays transitive. A verbatim NaN here
  // poisons `right.priority - left.priority` and yields implementation-defined order.
  if (typeof priority === 'number') return Number.isFinite(priority) ? priority : 0;

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
