import type { TrustedHtml } from '@kovojs/browser';
import type { ComponentChild } from '@kovojs/core';

import { escapeAttribute, renderedHtml, renderedHtmlContent, type RenderedHtml } from './html.js';
import {
  deferredStreamInitialChunkCount,
  type DeferredPriority,
  type DeferredStreamChunk,
} from './deferred-stream.js';
import type { StylesheetAsset } from './hints.js';
import { currentJsxFrameworkContext, type DeferredRegionCollector } from './jsx-context.js';
import { renderServerRenderable, type InternalServerRenderable } from './renderable.js';
import {
  createSecurityPromise,
  securityArrayPush,
  securityIsPromise,
  securityPromiseResolve,
  securityPromiseThen,
} from './response-security-intrinsics.js';

type MaybePromise<Value> = Promise<Value> | Value;

/** Priority for a server-rendered region inside the initial route document (SPEC §8). */
export type RegionPriority = 'after-paint' | 'critical' | 'visible';

/**
 * Renderable values accepted by server JSX primitives.
 *
 * Strings and numbers render as escaped text, JSX/runtime HTML renders as markup, arrays flatten,
 * and promises are awaited by the server renderer (SPEC §8).
 */
export type ServerRenderable =
  | ComponentChild
  | ServerRenderable[]
  | readonly ServerRenderable[]
  | TrustedHtml
  | Promise<ServerRenderable>;

/** Props for {@link Defer}, the public JSX-native route-region deferral primitive. */
export interface DeferProps {
  /** Stable fragment target that the deferred stream will morph into. */
  target: string;
  /** Region priority. `critical` renders immediately; deferred regions stream after the shell. */
  priority?: RegionPriority;
  /** Placeholder content rendered with normal JSX/text escaping rules. */
  fallback?: ServerRenderable;
  /** Render the real region content from server truth. */
  render: () => ServerRenderable;
  /** Stylesheets required by the deferred region when it is inserted. */
  stylesheets?: readonly (string | StylesheetAsset)[];
  /** Per-region render deadline before the fallback is marked failed. */
  timeoutMs?: number;
}

/** @internal Options for {@link defer}, the string-composition route-region lowering helper. */
export interface DeferredRegionOptions {
  /** Stable fragment target that the deferred stream will morph into. */
  target: string;
  /** Placeholder HTML kept in the initial shell until the region arrives. */
  fallback?: string;
  /** Region priority. `critical` renders immediately; deferred regions stream after the shell. */
  priority?: RegionPriority;
  /** Render the real region HTML from server truth. */
  render: () => Promise<string> | string;
  /** Stylesheets required by the deferred region when it is inserted. */
  stylesheets?: readonly (string | StylesheetAsset)[];
  /** Per-region render deadline before the fallback is marked failed. */
  timeoutMs?: number;
}

/**
 * Defer a route region until after the initial document shell with JSX-native fallback/rendering.
 *
 * Inside normal route document rendering, deferred priorities return a framework-owned
 * `<kovo-defer>` placeholder and record a fragment stream chunk that arrives later in the same
 * document response. Outside that document context, including mutation fragment renders, this
 * renders the full region immediately so refreshes remain complete (SPEC §8).
 */
export function Defer(props: DeferProps): ServerRenderable {
  return lowerDeferredRegion({
    fallback: props.fallback,
    render: props.render,
    renderFallback: renderDeferredRegionRenderable,
    renderRegion: renderDeferredRegionRenderable,
    target: props.target,
    ...(props.priority === undefined ? {} : { priority: props.priority }),
    ...(props.stylesheets === undefined ? {} : { stylesheets: props.stylesheets }),
    ...(props.timeoutMs === undefined ? {} : { timeoutMs: props.timeoutMs }),
  });
}

/**
 * @internal Lower-level string-composition helper for framework-owned callers that already hold
 * trusted HTML strings. App code should use {@link Defer} so fallback and render output go through
 * normal JSX/text escaping.
 */
export function defer(options: DeferredRegionOptions): MaybePromise<string> {
  return unrendered(
    lowerDeferredRegion({
      fallback: options.fallback ?? '',
      render: options.render,
      renderFallback: renderRawDeferredRegionString,
      renderRegion: renderRawDeferredRegionString,
      target: options.target,
      ...(options.priority === undefined ? {} : { priority: options.priority }),
      ...(options.stylesheets === undefined ? {} : { stylesheets: options.stylesheets }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    }),
  );
}

/** @internal */
export interface DeferredRegionChunkCollector extends DeferredRegionCollector {
  chunks(): Promise<readonly DeferredStreamChunk[]>;
  pendingChunks(): readonly Promise<DeferredStreamChunk>[];
}

/** @internal */
export function createDeferredRegionChunkCollector(): DeferredRegionChunkCollector {
  const chunks: Promise<DeferredStreamChunk>[] = [];
  return {
    add(chunk) {
      securityArrayPush(chunks, securityPromiseResolve(chunk));
    },
    async chunks() {
      const settled: DeferredStreamChunk[] = [];
      for (let index = 0; index < chunks.length; index += 1) {
        securityArrayPush(settled, await chunks[index]!);
      }
      return settled;
    },
    pendingChunks() {
      // SPEC §8: a deferred region render can itself discover more deferred regions. The document
      // stream consumes this live queue so nested regions registered while a chunk settles are not
      // stranded behind their fallback placeholders.
      void Object.defineProperty(chunks, deferredStreamInitialChunkCount, {
        configurable: true,
        value: chunks.length,
      });
      return chunks;
    },
  };
}

function deferredStreamPriority(priority: Exclude<RegionPriority, 'critical'>): DeferredPriority {
  switch (priority) {
    case 'after-paint':
      return 'normal';
    case 'visible':
      return 'visible';
  }
}

interface LowerDeferredRegionOptions<Input> {
  fallback: Input | undefined;
  priority?: RegionPriority;
  render: () => MaybePromise<Input>;
  renderFallback: (value: Input | undefined) => MaybePromise<string>;
  renderRegion: (value: Input) => MaybePromise<string>;
  stylesheets?: readonly (string | StylesheetAsset)[];
  target: string;
  timeoutMs?: number;
}

const DEFAULT_DEFER_TIMEOUT_MS = 30_000;

function lowerDeferredRegion<Input>(
  options: LowerDeferredRegionOptions<Input>,
): MaybePromise<RenderedHtml> {
  const priority = options.priority ?? 'critical';
  const renderRegion = () => {
    const value = options.render();
    return securityIsPromise(value)
      ? securityPromiseThen(securityPromiseResolve(value), (resolved) =>
          options.renderRegion(resolved),
        )
      : options.renderRegion(value);
  };
  const renderNow = () => rendered(renderRegion());
  if (priority === 'critical') return renderNow();

  const collector = currentJsxFrameworkContext()?.deferredRegions;
  if (!collector) return renderNow();

  const streamPriority = deferredStreamPriority(priority);
  const regionChunk = securityPromiseThen(
    securityPromiseThen(securityPromiseResolve(undefined), renderRegion),
    (html) => ({
      fragments: [
        {
          html,
          priority: streamPriority,
          ...(options.stylesheets === undefined ? {} : { stylesheets: options.stylesheets }),
          target: options.target,
        },
      ],
      priority: streamPriority,
    }),
    () => renderDeferredErrorChunk(options, priority, streamPriority),
  );
  collector.add(
    withDeferredRegionTimeout(regionChunk, normalizeDeferredTimeoutMs(options.timeoutMs), () =>
      renderDeferredErrorChunk(options, priority, streamPriority),
    ),
  );

  return rendered(
    securityPromiseThen(
      securityPromiseResolve(options.renderFallback(options.fallback)),
      (fallback) => placeholder(options.target, priority, fallback),
    ),
  );
}

async function renderDeferredErrorChunk<Input>(
  options: LowerDeferredRegionOptions<Input>,
  priority: Exclude<RegionPriority, 'critical'>,
  streamPriority: DeferredPriority,
): Promise<DeferredStreamChunk> {
  let fallback = '';
  try {
    fallback = await options.renderFallback(options.fallback);
  } catch {
    fallback = '';
  }
  return {
    fragments: [
      {
        html: placeholder(options.target, priority, fallback, 'error'),
        priority: streamPriority,
        target: options.target,
      },
    ],
    priority: streamPriority,
  };
}

function withDeferredRegionTimeout(
  chunk: Promise<DeferredStreamChunk>,
  timeoutMs: number,
  onTimeout: () => Promise<DeferredStreamChunk>,
): Promise<DeferredStreamChunk> {
  return createSecurityPromise((resolve, reject) => {
    const timer = setTimeout(() => {
      void securityPromiseThen(securityPromiseResolve(onTimeout()), resolve, reject);
    }, timeoutMs);
    void securityPromiseThen(
      chunk,
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function normalizeDeferredTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_DEFER_TIMEOUT_MS;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('Defer timeoutMs must be a non-negative finite number');
  }
  return value;
}

function renderDeferredRegionRenderable(value: ServerRenderable | undefined): MaybePromise<string> {
  return renderServerRenderable(value as InternalServerRenderable);
}

function renderRawDeferredRegionString(value: string | undefined): string {
  return value ?? '';
}

function placeholder(
  target: string,
  priority: Exclude<RegionPriority, 'critical'>,
  fallback: string,
  state = 'pending',
): string {
  return `<kovo-defer target="${escapeAttribute(target)}" state="${escapeAttribute(state)}" data-kovo-region-priority="${escapeAttribute(priority)}">${fallback}</kovo-defer>`;
}

function rendered(value: MaybePromise<string>): MaybePromise<RenderedHtml> {
  return securityIsPromise(value)
    ? securityPromiseThen(securityPromiseResolve(value), (html) => renderedHtml(html))
    : renderedHtml(value);
}

function unrendered(value: MaybePromise<RenderedHtml>): MaybePromise<string> {
  return securityIsPromise(value)
    ? securityPromiseThen(securityPromiseResolve(value), (html) => renderedHtmlContent(html))
    : renderedHtmlContent(value);
}
