import { kovoTrustedHtmlContent } from '@kovojs/browser/internal/output';
import type { TrustedHtml } from '@kovojs/browser';

import { reportServerError } from '../diagnostics.js';
import type { ServerErrorDiagnosticContext, ServerErrorHandler } from '../diagnostics.js';
import { isRenderedHtml } from '../html.js';
import type { BufferedMutationWireResponse, MutationWireResponse } from '../mutation-wire.js';
import type { MutationReplayReservation } from '../replay.js';
import {
  renderDoneWireHtml,
  renderFragmentWireHtml,
  renderQueryWireHtml,
  renderTextWireHtml,
} from '../wire-html.js';
import type { MutationSuccess } from './definition.js';

/** Rendered JSX or explicit trusted HTML accepted by `stream.fragment()` (SPEC §9.1, KV236). */
export type MutationStreamFragmentHtml =
  | TrustedHtml
  | {
      readonly html: string;
      [Symbol.toPrimitive](): string;
      toString(): string;
    };

/** A server-rendered fragment chunk for a SPEC §9.1 streaming mutation response. */
export interface MutationStreamFragmentChunk {
  html: MutationStreamFragmentHtml;
  kind: 'fragment';
  mode?: 'append' | 'replace';
  target: string;
}

/** An escaped text-source chunk for a SPEC §9.1 streaming mutation response. */
export interface MutationStreamTextChunk {
  kind: 'text';
  mode?: 'append' | 'checkpoint';
  target: string;
  text: string;
}

/** A query-truth chunk for a SPEC §9.1 streaming mutation response. */
export interface MutationStreamQueryChunk {
  delta?: boolean;
  key?: string;
  kind: 'query';
  name: string;
  value: unknown;
  version?: number | string;
}

/** A readable terminal marker for a SPEC §9.1 streaming mutation response. */
export interface MutationStreamDoneChunk {
  kind: 'done';
  reason?: string;
}

/** A typed chunk yielded by a streaming mutation author function (SPEC §9.1). */
export type MutationStreamChunk =
  | MutationStreamDoneChunk
  | MutationStreamFragmentChunk
  | MutationStreamQueryChunk
  | MutationStreamTextChunk;

/** Context passed to a streaming mutation author function after the mutation succeeds. */
export interface MutationStreamContext<Value = unknown, Input = unknown, Request = unknown> {
  input: Input;
  request: Request;
  result: MutationSuccess<Value, Input>;
}

/** Iterable chunk source returned by a streaming mutation author function. */
export type MutationStreamSource<_Value, _Input, _Request> =
  | AsyncIterable<MutationStreamChunk>
  | Iterable<MutationStreamChunk>;

/** Coarse server-side text coalescing policy for streaming mutation text chunks. */
export interface MutationTextCoalescingPolicy {
  maxDelayMs?: number;
  maxTextChars?: number;
}

const defaultMutationTextCoalescingPolicy: Required<MutationTextCoalescingPolicy> = {
  maxDelayMs: 32,
  maxTextChars: 2048,
};

/**
 * Build SPEC §9.1 streaming mutation wire chunks. Text chunks are escaped by the server
 * renderer and are coalesced before being written to the response stream.
 */
export const stream = {
  done(options: { reason?: string } = {}): MutationStreamDoneChunk {
    return { kind: 'done', ...(options.reason === undefined ? {} : { reason: options.reason }) };
  },
  fragment(options: {
    html: MutationStreamFragmentHtml;
    mode?: 'append' | 'replace';
    target: string;
  }): MutationStreamFragmentChunk {
    return {
      html: options.html,
      kind: 'fragment',
      ...(options.mode === undefined ? {} : { mode: options.mode }),
      target: options.target,
    };
  },
  query(options: {
    delta?: boolean;
    key?: string;
    name: string;
    value: unknown;
    version?: number | string;
  }): MutationStreamQueryChunk {
    return {
      ...(options.delta === undefined ? {} : { delta: options.delta }),
      ...(options.key === undefined ? {} : { key: options.key }),
      kind: 'query',
      name: options.name,
      value: options.value,
      ...(options.version === undefined ? {} : { version: options.version }),
    };
  },
  text(
    target: string,
    text: string,
    options: { mode?: 'append' | 'checkpoint' } = {},
  ): MutationStreamTextChunk {
    return {
      kind: 'text',
      ...(options.mode === undefined ? {} : { mode: options.mode }),
      target,
      text,
    };
  },
};

/**
 * L10-1 (SPEC §9): error-reporting context threaded into the streaming render so a
 * generator that throws mid-stream can report via `onError` and emit a failure
 * terminator. `'mutation-stream'` is not yet a member of the shared
 * `ServerErrorDiagnosticContext.operation` union, so the context is cast at the
 * reporting boundary; the runtime value the diagnostic hook observes is unchanged.
 */
export interface StreamingMutationErrorContext {
  context: {
    mutationKey: string;
    operation: string;
    request: unknown;
    targets?: readonly string[] | undefined;
  };
  onError?: ServerErrorHandler | undefined;
}

export function renderStreamingMutationWireResponse(
  chunks: MutationStreamSource<unknown, unknown, unknown>,
  finalResponse: BufferedMutationWireResponse,
  reservation?: MutationReplayReservation<BufferedMutationWireResponse>,
  errorContext?: StreamingMutationErrorContext,
): MutationWireResponse {
  const encoder = new TextEncoder();
  // H4 (SPEC §9): retain a reference to the raw source iterator so the cancel
  // handler can call return() on it directly — the coalesce layer's inner await
  // on a pending read won't propagate the cancel signal automatically.
  const sourceIterator = toAsyncIterator(chunks);
  const sourceIterable: AsyncIterable<MutationStreamChunk> = {
    [Symbol.asyncIterator]: () => sourceIterator,
  };
  const source = coalesceMutationStreamChunks(sourceIterable);
  const iterator = source[Symbol.asyncIterator]();

  return {
    body: new ReadableStream<Uint8Array>({
      async start(controller) {
        // A3 (SPEC §10.3:1063): buffer all emitted bytes so we can commit the full
        // settled body (stream chunks + finalResponse.body + <kovo-done>) to the
        // replay store after the stream completes, not the head-only body before.
        const buffered: string[] = [];

        const enqueue = (text: string): void => {
          const line = `${text}\n`;
          buffered.push(line);
          controller.enqueue(encoder.encode(line));
        };

        try {
          for (;;) {
            const { done, value: chunk } = await iterator.next();
            if (done) break;
            enqueue(renderMutationStreamChunk(chunk));
            if (chunk.kind === 'done') {
              controller.close();
              // Commit the full settled body so replays re-serve the complete stream.
              reservation?.commit({
                body: buffered.join(''),
                headers: finalResponse.headers,
                status: finalResponse.status,
              });
              return;
            }
          }
          // Generator exhausted without an explicit done chunk; emit the reconciled
          // fragment body (pre-rendered query/fragment HTML) and kovo-done.
          if (finalResponse.body) enqueue(finalResponse.body);
          enqueue(renderDoneWireHtml());
          controller.close();
          // Commit after the generator exhausted (no explicit done chunk).
          reservation?.commit({
            body: buffered.join(''),
            headers: finalResponse.headers,
            status: finalResponse.status,
          });
        } catch (error) {
          // L10-1 (SPEC §9): a streaming generator threw mid-stream. Report it via the
          // server error hook and emit a `<kovo-done reason="error">` terminator so the
          // client observes a clean, in-band end-of-stream (mirroring the explicit
          // `stream.done({ reason: 'error' })` path) instead of a silent hang. The
          // reservation is aborted, never committed, so the failed stream is not replayed.
          if (errorContext) {
            reportServerError(
              errorContext.onError,
              error,
              errorContext.context as ServerErrorDiagnosticContext,
            );
          }
          try {
            enqueue(renderDoneWireHtml({ reason: 'error' }));
            controller.close();
          } catch {
            // The controller may already be errored/closed (e.g. the consumer cancelled
            // concurrently); fall back to surfacing the original error on the stream.
            controller.error(error);
          }
          // Do not commit on error; let the reservation remain pending/aborted.
          reservation?.abort?.();
        }
      },
      cancel() {
        // H4 (SPEC §9): propagate client disconnect to the author generator so its
        // finally block runs. We call return() on the raw sourceIterator (not the
        // coalesced iterator) because the coalesce layer holds a pending .next() call
        // that won't resolve until the source yields — the return() must reach the
        // source generator directly to interrupt it.
        void sourceIterator.return?.();
      },
    }),
    headers: finalResponse.headers,
    status: finalResponse.status,
  };
}

export async function* coalesceMutationStreamChunks(
  chunks: MutationStreamSource<unknown, unknown, unknown>,
  policy: MutationTextCoalescingPolicy = {},
): AsyncIterable<MutationStreamChunk> {
  const maxDelayMs = policy.maxDelayMs ?? defaultMutationTextCoalescingPolicy.maxDelayMs;
  const maxTextChars = policy.maxTextChars ?? defaultMutationTextCoalescingPolicy.maxTextChars;
  const iterator = toAsyncIterator(chunks);
  let pendingRead: Promise<IteratorResult<MutationStreamChunk>> | undefined;
  let bufferedText: MutationStreamTextChunk | undefined;
  let bufferedSince = 0;
  let timer: Promise<'flush'> | undefined;

  const flush = function* (): Generator<MutationStreamTextChunk> {
    if (!bufferedText) return;
    const chunk = bufferedText;
    bufferedText = undefined;
    bufferedSince = 0;
    timer = undefined;
    yield chunk;
  };

  for (;;) {
    pendingRead ??= iterator.next();
    if (bufferedText && maxDelayMs <= 0) {
      yield* flush();
      continue;
    }
    timer ??=
      bufferedText && maxDelayMs > 0
        ? new Promise<'flush'>((resolve) => setTimeout(() => resolve('flush'), maxDelayMs))
        : undefined;

    let next: IteratorResult<MutationStreamChunk> | 'flush';
    try {
      next = timer === undefined ? await pendingRead : await Promise.race([pendingRead, timer]);
    } catch (error) {
      // L10-1 (SPEC §9): the source generator threw mid-stream. Flush any buffered text
      // so already-yielded partial output is not lost, then propagate the error so the
      // streaming render's catch can report it and emit the failure terminator.
      yield* flush();
      throw error;
    }
    if (next === 'flush') {
      yield* flush();
      continue;
    }

    pendingRead = undefined;
    if (next.done) {
      yield* flush();
      return;
    }

    const chunk = next.value;
    if (chunk.kind !== 'text' || chunk.mode === 'checkpoint') {
      yield* flush();
      yield chunk;
      continue;
    }

    if (!bufferedText) {
      bufferedText = { ...chunk, mode: 'append' };
      bufferedSince = Date.now();
      timer = undefined;
    } else if (bufferedText.target === chunk.target) {
      bufferedText = {
        ...bufferedText,
        text: `${bufferedText.text}${chunk.text}`,
      };
    } else {
      yield* flush();
      bufferedText = { ...chunk, mode: 'append' };
      bufferedSince = Date.now();
    }

    if (
      bufferedText.text.length >= maxTextChars ||
      (bufferedSince > 0 && Date.now() - bufferedSince >= maxDelayMs)
    ) {
      yield* flush();
    }
  }
}

function toAsyncIterator(
  chunks: MutationStreamSource<unknown, unknown, unknown>,
): AsyncIterator<MutationStreamChunk> {
  if (Symbol.asyncIterator in chunks) return chunks[Symbol.asyncIterator]();
  return (async function* () {
    yield* chunks;
  })()[Symbol.asyncIterator]();
}

function renderMutationStreamChunk(chunk: MutationStreamChunk): string {
  switch (chunk.kind) {
    case 'done':
      return renderDoneWireHtml({ reason: chunk.reason });
    case 'fragment':
      return renderFragmentWireHtml({
        html: renderMutationStreamFragmentHtml(chunk.html),
        mode: chunk.mode,
        target: chunk.target,
      });
    case 'query':
      return renderQueryWireHtml({
        delta: chunk.delta,
        key: chunk.key,
        name: chunk.name,
        value: chunk.value,
        version: chunk.version,
      });
    case 'text':
      return renderTextWireHtml({
        mode: chunk.mode,
        target: chunk.target,
        text: chunk.text,
      });
  }
}

function renderMutationStreamFragmentHtml(html: MutationStreamFragmentHtml): string {
  if (isRenderedHtml(html)) return html.html;
  const trustedHtml = kovoTrustedHtmlContent(html);
  if (trustedHtml !== '') return trustedHtml;
  if (
    typeof html === 'object' &&
    html !== null &&
    'html' in html &&
    typeof html.html === 'string'
  ) {
    return html.html;
  }
  return '';
}
