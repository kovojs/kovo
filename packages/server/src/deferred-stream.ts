import { cspHashAttribute, cspSha256, type CspInlineMetadata } from './csp.js';
import { generatedFragmentHtmlValue } from './html.js';
import { snapshotStylesheetAsset, type StylesheetAsset } from './hints.js';
import type { GeneratedFragmentRenderable } from './renderable.js';
import type { ServerResponseBase } from './response.js';
import { renderFragmentWireHtml, renderQueryWireHtml } from './wire-html.js';
import {
  createSecurityReadableStream,
  securityArrayIsArray,
  securityArrayJoin,
  securityArrayPush,
  securityArraySort,
  securityBufferToString,
  securityNumberIsFinite,
  securityNumberIsInteger,
  securityNumberParseInt,
  securityIsPromise,
  securityPromiseRace,
  securityPromiseResolve,
  securityPromiseThen,
  securityRandomBytes,
  securityRegExpReplaceMatches,
  securityStreamClose,
  securityStreamEnqueue,
  securityStreamError,
  securityStringFromCodePoint,
  securityStringIncludes,
  securityStringIndexOf,
  securityStringSlice,
  securityStringSplit,
  securityStringStartsWith,
  securityTextEncode,
} from './response-security-intrinsics.js';
import { witnessGetOwnPropertyDescriptor, witnessObjectIs } from './security-witness-intrinsics.js';

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
  html: GeneratedFragmentRenderable;
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
export interface DeferredStreamingOptions {
  boundary?: string;
  chunks: readonly (DeferredStreamChunk | Promise<DeferredStreamChunk>)[];
  closeHtml?: string;
  shell: string;
}

/** One deferred route-region stream chunk. */
export interface DeferredStreamChunk {
  fragments: readonly DeferredFragmentChunk[];
  priority?: DeferredPriority;
  queries?: readonly DeferredQueryChunk[];
}

/** @internal */
export const deferredStreamInitialChunkCount = Symbol('kovo.deferredStreamInitialChunkCount');

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

/** @internal */
export interface DeferredStreamingResponse extends ServerResponseBase<
  ReadableStream<Uint8Array>,
  Record<string, string>,
  200
> {
  csp: CspInlineMetadata;
}

/**
 * Render the framework's deferred fragment stream payload.
 *
 * @internal
 */
export function renderDeferredStream(options: DeferredStreamOptions): DeferredStreamResponse {
  const snapshot = snapshotDeferredStreamOptions(options);
  const baseBoundary = snapshot.boundary ?? 'kovo-boundary';
  // L13-1 (bugs-part4) + M3 (bugz-3; SPEC §9 deferred stream): the chunk separator is a
  // multipart-style line `--<boundary>`, but the emitted client apply/cleanup scripts match the
  // boundary by SUBSTRING (`textContent.includes("--<boundary>")`, see `cleanupScriptBody` and
  // `deferredChunkApplyScriptBody` below) — NOT by exact line. So any rendered content that merely
  // CONTAINS `--<boundary>` (anywhere in a text node, not only a standalone line) forges a break:
  // the apply walk stops early and drops a co-located `<kovo-query>`, and the cleanup removes the
  // whole shell child node. Collision detection must therefore mirror the client (substring) AND
  // scan `options.shell` (the page body the cleanup walks), not just the serialized chunks.
  // Serialize the chunk CONTENT first (queries + fragments only, never the framework's own
  // markers/apply scripts), include the shell, then choose a boundary whose `--<boundary>` marker
  // never appears as a substring of any content. When nothing collides we keep `baseBoundary`
  // verbatim so the canonical wire byte layout (the golden `defer-stream.http` fixture) is
  // unchanged; only a real collision re-rolls to a high-entropy `<base>-<token>` variant and
  // re-checks.
  const sortedChunks = sortDeferredChunks(snapshot.chunks);
  const serializedChunks: string[][] = [];
  for (let index = 0; index < sortedChunks.length; index += 1) {
    const chunk = sortedChunks[index]!;
    const lines = renderDeferredQueryChunks(chunk.queries ?? []);
    for (let fragmentIndex = 0; fragmentIndex < chunk.fragments.length; fragmentIndex += 1) {
      securityArrayPush(lines, renderDeferredFragmentChunk(chunk.fragments[fragmentIndex]!));
    }
    securityArrayPush(serializedChunks, lines);
  }
  const contentLines = collectContentLines(snapshot.shell, serializedChunks);
  const boundary = chooseNonCollidingBoundary(baseBoundary, contentLines);
  // K8 / SPEC: the inline apply and cleanup scripts must reference the configurable
  // boundary, not the hardcoded 'kovo-boundary' literal. Interpolate `--${boundary}`
  // so non-default boundaries work correctly.
  //
  // G1 (bugs-part3 CSP-1): the script BODIES are hashed for CSP (the hash is computed
  // over the inline content, not the wrapping tag) and each `<script>` is stamped with
  // the matching `data-kovo-csp-hash` so a strict hash-CSP admits them; the hashes are
  // surfaced on `csp` so `renderDeferredDocument` merges them into `document.csp`.
  const cleanupScriptBody = deferredCloseCleanupScriptBody(boundary);
  const cleanupHash = cspSha256(cleanupScriptBody);
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
  const applyScriptBody = deferredChunkApplyScriptBody(boundary);
  const applyHash = cspSha256(applyScriptBody);
  const deferredApplyScript = `<script ${cspHashAttribute(applyHash)}>${applyScriptBody}</script>`;
  const chunks: string[] = [];
  for (let index = 0; index < serializedChunks.length; index += 1) {
    const chunkLines = [`--${boundary}`];
    appendArray(chunkLines, serializedChunks[index]!);
    securityArrayPush(chunkLines, deferredApplyScript);
    securityArrayPush(chunks, securityArrayJoin(chunkLines, '\n'));
  }

  return {
    body: assembleDeferredBody(
      snapshot.shell,
      chunks,
      boundary,
      deferredCloseCleanupScript,
      snapshot.closeHtml ?? '',
    ),
    // Dedupe: the apply hash repeats once per chunk but the CSP hash list is a set.
    csp: { scripts: [applyHash, cleanupHash], styles: [] },
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
    status: 200,
  };
}

interface StreamDeferredChunksOptions {
  applyScript: string;
  boundary: string;
  chunks: readonly (DeferredStreamChunk | Promise<DeferredStreamChunk>)[];
  cleanupScript: string;
  closeHtml: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
}

async function streamDeferredChunks(options: StreamDeferredChunksOptions): Promise<void> {
  const pending: {
    index: number;
    promise: Promise<{ index: number; value: DeferredStreamChunk }>;
  }[] = [];
  let nextIndex = 0;
  const collectPending = (limit: number) => {
    while (nextIndex < limit && nextIndex < options.chunks.length) {
      const index = nextIndex;
      const chunk = stableArrayValue(options.chunks, index, 'deferred streaming chunks');
      nextIndex += 1;
      const promise = securityIsPromise(chunk)
        ? securityPromiseThen(chunk, (value) => ({
            index,
            value: snapshotDeferredStreamChunk(value),
          }))
        : securityPromiseResolve({ index, value: snapshotDeferredStreamChunk(chunk) });
      securityArrayPush(pending, { index, promise });
    }
  };

  try {
    collectPending(initialDeferredChunkCount(options.chunks));
    while (pending.length > 0) {
      const promises: Promise<{ index: number; value: DeferredStreamChunk }>[] = [];
      for (let index = 0; index < pending.length; index += 1) {
        securityArrayPush(promises, pending[index]!.promise);
      }
      const settled = await securityPromiseRace(promises);
      let pendingIndex = -1;
      for (let index = 0; index < pending.length; index += 1) {
        if (pending[index]!.index === settled.index) pendingIndex = index;
      }
      if (pendingIndex !== -1) removeArrayIndex(pending, pendingIndex);
      securityStreamEnqueue(
        options.controller,
        securityTextEncode(
          `\n${serializeDeferredStreamChunk(options.boundary, settled.value, options.applyScript)}`,
        ),
      );
      // SPEC §8: rendering a settled deferred region may have registered nested regions into the
      // same live queue. Drain newly discovered work before closing the stream.
      collectPending(options.chunks.length);
    }
    securityStreamEnqueue(
      options.controller,
      securityTextEncode(
        `\n--${options.boundary}--\n${options.cleanupScript}\n${options.closeHtml}`,
      ),
    );
    securityStreamClose(options.controller);
  } catch (error) {
    securityStreamError(options.controller, error);
  }
}

function initialDeferredChunkCount(
  chunks: readonly (DeferredStreamChunk | Promise<DeferredStreamChunk>)[],
): number {
  const descriptor = witnessGetOwnPropertyDescriptor(chunks, deferredStreamInitialChunkCount);
  const initial =
    descriptor === undefined || !('value' in descriptor) ? undefined : descriptor.value;
  return typeof initial === 'number' && securityNumberIsInteger(initial) && initial >= 0
    ? initial
    : chunks.length;
}

/**
 * Render a live deferred stream. The shell is enqueued immediately; each deferred chunk is
 * serialized when its region promise settles, so one slow region cannot hold the first paint
 * hostage (SPEC §8).
 *
 * @internal
 */
export function renderDeferredStreamingResponse(
  options: DeferredStreamingOptions,
): DeferredStreamingResponse {
  const snapshot = snapshotDeferredStreamingOptions(options);
  const baseBoundary = snapshot.boundary ?? `kovo-boundary-${randomBoundaryToken()}`;
  const contentLines = collectContentLines(snapshot.shell, []);
  const boundary = chooseNonCollidingBoundary(baseBoundary, contentLines);
  const cleanupScriptBody = deferredCloseCleanupScriptBody(boundary);
  const cleanupHash = cspSha256(cleanupScriptBody);
  const deferredCloseCleanupScript = `<script ${cspHashAttribute(cleanupHash)}>${cleanupScriptBody}</script>`;
  const applyScriptBody = deferredChunkApplyScriptBody(boundary);
  const applyHash = cspSha256(applyScriptBody);
  const deferredApplyScript = `<script ${cspHashAttribute(applyHash)}>${applyScriptBody}</script>`;
  const body = createSecurityReadableStream<Uint8Array>({
    start(controller) {
      securityStreamEnqueue(controller, securityTextEncode(snapshot.shell));
      void streamDeferredChunks({
        applyScript: deferredApplyScript,
        boundary,
        chunks: snapshot.chunks,
        closeHtml: snapshot.closeHtml ?? '',
        cleanupScript: deferredCloseCleanupScript,
        controller,
      });
    },
  });

  return {
    body,
    csp: { scripts: [applyHash, cleanupHash], styles: [] },
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
    status: 200,
  };
}

/**
 * L13-1 (bugs-part4) + M3 (bugz-3): collect every line of attacker-reachable content the client
 * scripts walk — the page `shell` (scanned by the cleanup over `document.body.childNodes`) and the
 * serialized query/fragment chunks (walked by the per-chunk apply). The framework's own boundary
 * markers and apply/cleanup scripts are NOT included — only content an author/attacker controls —
 * so a line that CONTAINS `--<boundary>` (the client's substring test) is the forged-boundary case.
 */
function collectContentLines(
  shell: string,
  serializedChunks: readonly (readonly string[])[],
): string[] {
  const lines: string[] = [];
  collectHtmlBoundaryScanLines(lines, shell);
  for (let chunkIndex = 0; chunkIndex < serializedChunks.length; chunkIndex += 1) {
    const chunkLines = serializedChunks[chunkIndex]!;
    for (let contentIndex = 0; contentIndex < chunkLines.length; contentIndex += 1) {
      collectHtmlBoundaryScanLines(lines, chunkLines[contentIndex]!);
    }
  }
  return lines;
}

function collectHtmlBoundaryScanLines(lines: string[], html: string): void {
  appendArray(lines, securityStringSplit(html, '\n'));
  const text = htmlTextContent(html);
  if (text !== html) {
    appendArray(lines, securityStringSplit(text, '\n'));
  }
}

function htmlTextContent(html: string): string {
  let text = '';
  let offset = 0;

  while (offset < html.length) {
    const tagStart = securityStringIndexOf(html, '<', offset);
    if (tagStart === -1) {
      text += securityStringSlice(html, offset);
      break;
    }

    text += securityStringSlice(html, offset, tagStart);
    if (securityStringStartsWith(html, '<!--', tagStart)) {
      const commentEnd = securityStringIndexOf(html, '-->', tagStart + 4);
      offset = commentEnd === -1 ? html.length : commentEnd + 3;
      continue;
    }

    const tagEnd = securityStringIndexOf(html, '>', tagStart + 1);
    if (tagEnd === -1) {
      text += securityStringSlice(html, tagStart);
      break;
    }
    offset = tagEnd + 1;
  }

  return decodeHtmlTextEntities(text);
}

function decodeHtmlTextEntities(value: string): string {
  return securityRegExpReplaceMatches(
    value,
    /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,
    (match) => {
      const entity = match[0];
      const body = match[1]!;
      if (securityStringStartsWith(body, '#x')) {
        return decodeNumericEntity(
          entity,
          securityNumberParseInt(securityStringSlice(body, 2), 16),
        );
      }
      if (securityStringStartsWith(body, '#')) {
        return decodeNumericEntity(
          entity,
          securityNumberParseInt(securityStringSlice(body, 1), 10),
        );
      }
      switch (body) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        default:
          return entity;
      }
    },
  );
}

function decodeNumericEntity(entity: string, codePoint: number): string {
  if (!securityNumberIsInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return entity;
  try {
    return securityStringFromCodePoint(codePoint);
  } catch {
    return entity;
  }
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
  // M3 (bugz-3; SPEC §9 deferred stream): mirror the client's SUBSTRING test
  // (`textContent.includes("--<boundary>")`) rather than an exact-line match. Content that merely
  // CONTAINS `--<boundary>` would forge a break/cleanup on the client, so it must force a re-roll.
  // The close marker `--<boundary>--` contains the open marker, so the single substring check
  // covers both separators.
  const marker = `--${boundary}`;
  for (let index = 0; index < contentLines.length; index += 1) {
    if (securityStringIncludes(contentLines[index]!, marker)) return true;
  }
  return false;
}

function randomBoundaryToken(): string {
  // 128 bits of entropy as lowercase hex (HTML/attribute-safe, no characters that could be
  // mistaken for boundary or markup syntax). `node:crypto` matches the rest of the server
  // package (csp/csrf) instead of relying on a global `crypto`.
  return securityBufferToString(securityRandomBytes(16), 'hex');
}

function deferredCloseCleanupScriptBody(boundary: string): string {
  return `for(var n of [...document.body.childNodes])if((n.textContent||"").includes("--${boundary}"))n.remove();document.currentScript.remove()`;
}

function deferredChunkApplyScriptBody(boundary: string): string {
  const collectBody = `var s=document.currentScript,n=s.previousSibling,e=[];for(;n;){var p=n.previousSibling,t=n.textContent||"";if(n.outerHTML)e.unshift(n.outerHTML);n.remove();if(t.includes("--${boundary}"))break;n=p}`;
  return `${collectBody}var b=e.join("\\n"),a=()=>globalThis.__kovo_a?.(b),o=globalThis.IntersectionObserver&&new IntersectionObserver((r)=>{for(const x of r)if(x.isIntersecting){o.disconnect();a();break}},{rootMargin:"600px 0px"}),c=0;if(o){var m=b.match(/<kovo-fragment\\b[^>]*>/g)||[];for(var h of m){if(!/\\bpriority=["']visible["']/.test(h))continue;var v=(h.match(/\\btarget=["']([^"']+)["']/)||[])[1];var d=v&&[...document.getElementsByTagName("kovo-defer")].find((x)=>x.getAttribute("target")===v);if(d){o.observe(d);c++}}}if(!c)a();s.remove()`;
}

function renderDeferredFragmentChunk(fragment: DeferredFragmentChunk): string {
  return renderFragmentWireHtml({
    html: generatedFragmentHtmlValue(fragment.html),
    mode: fragment.mode,
    priority: fragment.priority,
    stylesheets: fragment.stylesheets,
    target: fragment.target,
  });
}

function renderDeferredQueryChunks(queries: readonly DeferredQueryChunk[]): string[] {
  const rendered: string[] = [];
  for (let index = 0; index < queries.length; index += 1) {
    const queryChunk = queries[index]!;
    securityArrayPush(
      rendered,
      renderQueryWireHtml({
        key: queryChunk.key || undefined,
        name: queryChunk.name,
        value: queryChunk.value,
      }),
    );
  }
  return rendered;
}

function serializeDeferredStreamChunk(
  boundary: string,
  chunk: DeferredStreamChunk,
  applyScript: string,
): string {
  const lines = [`--${boundary}`];
  appendArray(lines, renderDeferredQueryChunks(chunk.queries ?? []));
  for (let index = 0; index < chunk.fragments.length; index += 1) {
    securityArrayPush(lines, renderDeferredFragmentChunk(chunk.fragments[index]!));
  }
  securityArrayPush(lines, applyScript);
  return securityArrayJoin(lines, '\n');
}

function sortDeferredChunks(chunks: readonly DeferredStreamChunk[]): DeferredStreamChunk[] {
  return stablePrioritySort(chunks, (chunk) => chunk.priority);
}

function stablePrioritySort<Value>(
  values: readonly Value[],
  priorityFor: (value: Value) => DeferredPriority | undefined,
): Value[] {
  const ranked: { index: number; priority: number; value: Value }[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    securityArrayPush(ranked, { index, priority: priorityRank(priorityFor(value)), value });
  }
  // L2-deferred-1 (bugs-part3): `right.priority - left.priority` is NaN-poisoned when
  // a priority is non-finite, making the comparator non-transitive (implementation-
  // defined order). `priorityRank` already coerces non-finite to the normal floor (0),
  // so the subtraction is always finite; the `|| index` tiebreak keeps it stable.
  securityArraySort(
    ranked,
    (left, right) => right.priority - left.priority || left.index - right.index,
  );
  const sorted: Value[] = [];
  for (let index = 0; index < ranked.length; index += 1) {
    securityArrayPush(sorted, ranked[index]!.value);
  }
  return sorted;
}

function priorityRank(priority: DeferredPriority | undefined): number {
  // L2-deferred-1 (bugs-part3): coerce a non-finite numeric priority (NaN/±Infinity)
  // to the `normal` floor (0) so the comparator stays transitive. A verbatim NaN here
  // poisons `right.priority - left.priority` and yields implementation-defined order.
  if (typeof priority === 'number') return securityNumberIsFinite(priority) ? priority : 0;

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

function assembleDeferredBody(
  shell: string,
  chunks: readonly string[],
  boundary: string,
  cleanupScript: string,
  closeHtml: string,
): string {
  const parts = [shell];
  appendArray(parts, chunks);
  securityArrayPush(parts, `--${boundary}--`);
  securityArrayPush(parts, cleanupScript);
  securityArrayPush(parts, closeHtml);
  return securityArrayJoin(parts, '\n');
}

function appendArray<Value>(target: Value[], values: readonly Value[]): void {
  for (let index = 0; index < values.length; index += 1) {
    securityArrayPush(target, values[index]!);
  }
}

function removeArrayIndex<Value>(values: Value[], index: number): void {
  for (let cursor = index; cursor + 1 < values.length; cursor += 1) {
    values[cursor] = values[cursor + 1]!;
  }
  values.length -= 1;
}

function stableDeferredValue(value: object, property: PropertyKey, label: string): unknown {
  const before = witnessGetOwnPropertyDescriptor(value, property);
  const after = witnessGetOwnPropertyDescriptor(value, property);
  if ((before === undefined) !== (after === undefined)) {
    throw new TypeError(`${label}.${String(property)} must be stable.`);
  }
  if (before === undefined) return undefined;
  if (!('value' in before) || after === undefined || !('value' in after)) {
    throw new TypeError(`${label}.${String(property)} must be an own data property.`);
  }
  if (!witnessObjectIs(before.value, after.value)) {
    throw new TypeError(`${label}.${String(property)} changed during validation.`);
  }
  return before.value;
}

function stableArrayValue<Value>(values: readonly Value[], index: number, label: string): Value {
  const value = stableDeferredValue(values, index, label);
  if (value === undefined && !witnessGetOwnPropertyDescriptor(values, index)) {
    throw new TypeError(`${label} must be a dense own-data array.`);
  }
  return value as Value;
}

function snapshotDeferredArray<Value>(values: readonly Value[], label: string): Value[] {
  if (!securityArrayIsArray(values)) throw new TypeError(`${label} must be an array.`);
  const length = stableDeferredValue(values, 'length', label);
  if (typeof length !== 'number' || !securityNumberIsInteger(length) || length < 0) {
    throw new TypeError(`${label} length must be a non-negative integer.`);
  }
  const snapshot: Value[] = [];
  for (let index = 0; index < length; index += 1) {
    securityArrayPush(snapshot, stableArrayValue(values, index, label));
  }
  return snapshot;
}

function snapshotDeferredStreamOptions(options: DeferredStreamOptions): DeferredStreamOptions {
  const boundary = stableDeferredValue(options, 'boundary', 'deferred stream options');
  const chunks = stableDeferredValue(options, 'chunks', 'deferred stream options');
  const closeHtml = stableDeferredValue(options, 'closeHtml', 'deferred stream options');
  const shell = stableDeferredValue(options, 'shell', 'deferred stream options');
  if (boundary !== undefined && typeof boundary !== 'string') {
    throw new TypeError('deferred stream boundary must be a string.');
  }
  if (closeHtml !== undefined && typeof closeHtml !== 'string') {
    throw new TypeError('deferred stream closeHtml must be a string.');
  }
  if (typeof shell !== 'string') throw new TypeError('deferred stream shell must be a string.');
  if (!securityArrayIsArray(chunks))
    throw new TypeError('deferred stream chunks must be an array.');
  const chunkSnapshots: DeferredStreamChunk[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    securityArrayPush(
      chunkSnapshots,
      snapshotDeferredStreamChunk(stableArrayValue(chunks, index, 'deferred stream chunks')),
    );
  }
  return {
    ...(boundary === undefined ? {} : { boundary }),
    chunks: chunkSnapshots,
    ...(closeHtml === undefined ? {} : { closeHtml }),
    shell,
  };
}

function snapshotDeferredStreamingOptions(
  options: DeferredStreamingOptions,
): DeferredStreamingOptions {
  const boundary = stableDeferredValue(options, 'boundary', 'deferred streaming options');
  const chunks = stableDeferredValue(options, 'chunks', 'deferred streaming options');
  const closeHtml = stableDeferredValue(options, 'closeHtml', 'deferred streaming options');
  const shell = stableDeferredValue(options, 'shell', 'deferred streaming options');
  if (boundary !== undefined && typeof boundary !== 'string') {
    throw new TypeError('deferred streaming boundary must be a string.');
  }
  if (closeHtml !== undefined && typeof closeHtml !== 'string') {
    throw new TypeError('deferred streaming closeHtml must be a string.');
  }
  if (typeof shell !== 'string') throw new TypeError('deferred streaming shell must be a string.');
  if (!securityArrayIsArray(chunks))
    throw new TypeError('deferred streaming chunks must be an array.');
  const liveChunks = chunks as (DeferredStreamChunk | Promise<DeferredStreamChunk>)[];
  for (let index = 0; index < chunks.length; index += 1) {
    stableArrayValue(chunks, index, 'deferred streaming chunks');
  }
  return {
    ...(boundary === undefined ? {} : { boundary }),
    chunks: liveChunks,
    ...(closeHtml === undefined ? {} : { closeHtml }),
    shell,
  };
}

function snapshotDeferredStreamChunk(value: unknown): DeferredStreamChunk {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('deferred stream chunks must be objects.');
  }
  const fragments = stableDeferredValue(value, 'fragments', 'deferred stream chunk');
  const priority = stableDeferredValue(value, 'priority', 'deferred stream chunk');
  const queries = stableDeferredValue(value, 'queries', 'deferred stream chunk');
  if (!securityArrayIsArray(fragments)) {
    throw new TypeError('deferred stream chunk fragments must be an array.');
  }
  if (
    priority !== undefined &&
    typeof priority !== 'number' &&
    priority !== 'high' &&
    priority !== 'normal' &&
    priority !== 'low' &&
    priority !== 'visible'
  ) {
    throw new TypeError('deferred stream chunk priority is invalid.');
  }
  if (queries !== undefined && !securityArrayIsArray(queries)) {
    throw new TypeError('deferred stream chunk queries must be an array.');
  }
  const fragmentSnapshots: DeferredFragmentChunk[] = [];
  for (let index = 0; index < fragments.length; index += 1) {
    securityArrayPush(
      fragmentSnapshots,
      snapshotDeferredFragment(
        stableArrayValue(fragments, index, 'deferred stream chunk fragments'),
      ),
    );
  }
  const querySnapshots: DeferredQueryChunk[] = [];
  if (queries !== undefined) {
    for (let index = 0; index < queries.length; index += 1) {
      securityArrayPush(
        querySnapshots,
        snapshotDeferredQuery(stableArrayValue(queries, index, 'deferred stream chunk queries')),
      );
    }
  }
  return {
    fragments: fragmentSnapshots,
    ...(priority === undefined ? {} : { priority }),
    ...(queries === undefined ? {} : { queries: querySnapshots }),
  };
}

function snapshotDeferredFragment(value: unknown): DeferredFragmentChunk {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('deferred stream fragments must be objects.');
  }
  const html = stableDeferredValue(value, 'html', 'deferred stream fragment');
  const mode = stableDeferredValue(value, 'mode', 'deferred stream fragment');
  const priority = stableDeferredValue(value, 'priority', 'deferred stream fragment');
  const stylesheets = stableDeferredValue(value, 'stylesheets', 'deferred stream fragment');
  const target = stableDeferredValue(value, 'target', 'deferred stream fragment');
  if (typeof target !== 'string') throw new TypeError('deferred fragment target must be a string.');
  if (mode !== undefined && mode !== 'append' && mode !== 'replace') {
    throw new TypeError('deferred fragment mode is invalid.');
  }
  if (
    priority !== undefined &&
    typeof priority !== 'number' &&
    priority !== 'high' &&
    priority !== 'normal' &&
    priority !== 'low' &&
    priority !== 'visible'
  ) {
    throw new TypeError('deferred fragment priority is invalid.');
  }
  if (stylesheets !== undefined && !securityArrayIsArray(stylesheets)) {
    throw new TypeError('deferred fragment stylesheets must be an array.');
  }
  if (typeof html !== 'string' && (typeof html !== 'object' || html === null)) {
    throw new TypeError('deferred fragment html must be a generated renderable.');
  }
  const stylesheetSnapshots: (string | StylesheetAsset)[] | undefined =
    stylesheets === undefined ? undefined : [];
  if (stylesheets !== undefined && stylesheetSnapshots !== undefined) {
    const raw = snapshotDeferredArray(stylesheets, 'deferred fragment stylesheets');
    for (let index = 0; index < raw.length; index += 1) {
      const value = raw[index];
      if (typeof value === 'string') {
        securityArrayPush(stylesheetSnapshots, value);
      } else if (typeof value === 'object' && value !== null) {
        securityArrayPush(stylesheetSnapshots, snapshotStylesheetAsset(value as StylesheetAsset));
      } else {
        throw new TypeError('deferred fragment stylesheet entries are invalid.');
      }
    }
  }
  return {
    html: html as GeneratedFragmentRenderable,
    ...(mode === undefined ? {} : { mode }),
    ...(priority === undefined ? {} : { priority }),
    ...(stylesheetSnapshots === undefined ? {} : { stylesheets: stylesheetSnapshots }),
    target,
  };
}

function snapshotDeferredQuery(value: unknown): DeferredQueryChunk {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('deferred stream queries must be objects.');
  }
  const key = stableDeferredValue(value, 'key', 'deferred stream query');
  const name = stableDeferredValue(value, 'name', 'deferred stream query');
  const queryValue = stableDeferredValue(value, 'value', 'deferred stream query');
  if (key !== undefined && typeof key !== 'string') {
    throw new TypeError('deferred query key must be a string.');
  }
  if (typeof name !== 'string') throw new TypeError('deferred query name must be a string.');
  return {
    ...(key === undefined ? {} : { key }),
    name,
    value: queryValue,
  };
}
