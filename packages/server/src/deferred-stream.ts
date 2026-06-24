import { randomBytes } from 'node:crypto';

import { cspHashAttribute, cspNonceAttribute, cspSha256, type CspInlineMetadata } from './csp.js';
import type { StylesheetAsset } from './hints.js';
import type { ServerResponseBase } from './response.js';
import { renderFragmentWireHtml, renderQueryWireHtml } from './wire-html.js';

/** A query refresh payload carried by a deferred route-region stream. */
export interface DeferredQueryChunk {
  key?: string;
  name: string;
  value: unknown;
}

/** Priority ordering for deferred route-region stream chunks. */
export type DeferredPriority = 'high' | 'normal' | 'low' | 'visible' | number;

/** A fragment payload carried by a deferred route-region stream. */
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
  cspNonce?: string | undefined;
  shell: string;
}

/** One deferred route-region stream chunk. */
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
  const baseBoundary = options.boundary ?? 'kovo-boundary';
  // L13-1 (bugs-part4): the chunk separator is a multipart-style line `--<boundary>`.
  // Fragment content that contains a standalone `--<boundary>` line (a newline + the literal)
  // forges a chunk boundary — the client splits on it mid-content, truncating the first
  // fragment and dropping the later chunk. Serialize the chunk CONTENT first (queries +
  // fragments only, never the framework's own markers/apply scripts), then choose a boundary
  // that never appears as a `--<boundary>` / `--<boundary>--` content line. When nothing
  // collides we keep `baseBoundary` verbatim so the canonical wire byte layout (the golden
  // `defer-stream.http` fixture) is unchanged; only a real collision re-rolls to a
  // high-entropy `<base>-<token>` variant and re-checks.
  const sortedChunks = sortDeferredChunks(options.chunks);
  const serializedChunks = sortedChunks.map((chunk) => [
    ...renderDeferredQueryChunks(chunk.queries ?? []),
    ...chunk.fragments.map(renderDeferredFragmentChunk),
  ]);
  const contentLines = collectContentLines(serializedChunks);
  const boundary = chooseNonCollidingBoundary(baseBoundary, contentLines);
  // K8 / SPEC: the inline apply and cleanup scripts must reference the configurable
  // boundary, not the hardcoded 'kovo-boundary' literal. Interpolate `--${boundary}`
  // so non-default boundaries work correctly.
  //
  // G1 (bugs-part3 CSP-1): the script BODIES are hashed for CSP (the hash is computed
  // over the inline content, not the wrapping tag) and each `<script>` is stamped with
  // the matching `data-kovo-csp-hash` so a strict hash-CSP admits them; the hashes are
  // surfaced on `csp` so `renderDeferredDocument` merges them into `document.csp`.
  const cleanupScriptBody = `for(var n of [...document.body.childNodes])if((n.textContent||"").includes("--${boundary}"))n.remove();document.currentScript.remove()`;
  const cleanupHash = cspSha256(cleanupScriptBody);
  const deferredCloseCleanupScript = `<script${cspNonceAttribute(options.cspNonce)} ${cspHashAttribute(cleanupHash)}>${cleanupScriptBody}</script>`;
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
  const applyScriptBodies = sortedChunks.map((chunk) =>
    deferredChunkApplyScriptBody(boundary, visibleFragmentTargets(chunk)),
  );
  const applyHashes = applyScriptBodies.map(cspSha256);
  const chunks = serializedChunks.map((chunkLines, index) =>
    [
      `--${boundary}`,
      ...chunkLines,
      `<script${cspNonceAttribute(options.cspNonce)} ${cspHashAttribute(applyHashes[index] ?? '')}>${applyScriptBodies[index] ?? ''}</script>`,
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
    csp: {
      ...(options.cspNonce === undefined ? {} : { nonce: options.cspNonce }),
      scripts: [...new Set([...applyHashes, cleanupHash])],
      styles: [],
    },
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
    status: 200,
  };
}

/**
 * L13-1 (bugs-part4): split every serialized chunk-content string into its physical lines so
 * a boundary-collision check sees the exact byte lines the client splits on. The framework's
 * own boundary markers and apply/cleanup scripts are NOT included here — only attacker-reachable
 * query/fragment content — so a content line equal to `--<boundary>` is the forged-boundary case.
 */
function collectContentLines(serializedChunks: readonly (readonly string[])[]): string[] {
  const lines: string[] = [];
  for (const chunkLines of serializedChunks) {
    for (const content of chunkLines) {
      for (const line of content.split('\n')) lines.push(line);
    }
  }
  return lines;
}

/**
 * L13-1 (bugs-part4): pick a boundary token whose `--<boundary>` / `--<boundary>--` separator
 * lines never appear verbatim as a content line. Keeps `baseBoundary` when it is collision-free
 * (preserving the canonical wire byte layout); otherwise re-rolls to a high-entropy
 * `<base>-<token>` variant and re-checks until it is unique. The token search space (128 bits)
 * makes a forced collision after the first re-roll vanishingly unlikely, but the loop re-checks
 * every roll so correctness never depends on that probability.
 */
function chooseNonCollidingBoundary(baseBoundary: string, contentLines: readonly string[]): string {
  if (!boundaryCollides(baseBoundary, contentLines)) return baseBoundary;
  for (;;) {
    const candidate = `${baseBoundary}-${randomBoundaryToken()}`;
    if (!boundaryCollides(candidate, contentLines)) return candidate;
  }
}

function boundaryCollides(boundary: string, contentLines: readonly string[]): boolean {
  const marker = `--${boundary}`;
  const closeMarker = `--${boundary}--`;
  return contentLines.some((line) => line === marker || line === closeMarker);
}

function randomBoundaryToken(): string {
  // 128 bits of entropy as lowercase hex (HTML/attribute-safe, no characters that could be
  // mistaken for boundary or markup syntax). `node:crypto` matches the rest of the server
  // package (csp/csrf) instead of relying on a global `crypto`.
  return randomBytes(16).toString('hex');
}

function deferredChunkApplyScriptBody(boundary: string, visibleTargets: readonly string[]): string {
  const collectBody = `var s=document.currentScript,n=s.previousSibling,e=[];for(;n;){var p=n.previousSibling,t=n.textContent||"";if(n.outerHTML)e.unshift(n.outerHTML);n.remove();if(t.includes("--${boundary}"))break;n=p}`;
  if (visibleTargets.length === 0) {
    return `${collectBody}globalThis.__kovo_a?.(e.join("\\n"));s.remove()`;
  }

  return `${collectBody}var b=e.join("\\n"),a=()=>globalThis.__kovo_a?.(b),o=globalThis.IntersectionObserver&&new IntersectionObserver((r)=>{for(const x of r)if(x.isIntersecting){o.disconnect();a();break}},{rootMargin:"600px 0px"}),c=0;if(o){for(var v of ${JSON.stringify(visibleTargets)}){var d=[...document.getElementsByTagName("kovo-defer")].find((x)=>x.getAttribute("target")===v);if(d){o.observe(d);c++}}}if(!c)a();s.remove()`;
}

function visibleFragmentTargets(chunk: DeferredStreamChunk): readonly string[] {
  return chunk.fragments
    .filter((fragment) => fragment.priority === 'visible')
    .map((fragment) => fragment.target);
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
  return (
    values
      .map((value, index) => ({ index, priority: priorityRank(priorityFor(value)), value }))
      // L2-deferred-1 (bugs-part3): `right.priority - left.priority` is NaN-poisoned when
      // a priority is non-finite, making the comparator non-transitive (implementation-
      // defined order). `priorityRank` already coerces non-finite to the normal floor (0),
      // so the subtraction is always finite; the `|| index` tiebreak keeps it stable.
      .sort((left, right) => right.priority - left.priority || left.index - right.index)
      .map((entry) => entry.value)
  );
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
    case 'visible':
      return -1;
    case 'normal':
    case undefined:
      return 0;
  }
}
