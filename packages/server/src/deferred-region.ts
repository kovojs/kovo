import type { TrustedHtml } from '@kovojs/browser';

import { escapeAttribute, renderedHtml, type RenderedHtml } from './html.js';
import type { DeferredPriority, DeferredStreamChunk } from './deferred-stream.js';
import type { StylesheetAsset } from './hints.js';
import { currentJsxFrameworkContext, type DeferredRegionCollector } from './jsx-context.js';
import { renderServerRenderable, type InternalServerRenderable } from './renderable.js';

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
  | ServerRenderable[]
  | boolean
  | null
  | number
  | readonly ServerRenderable[]
  | { readonly html: string; [Symbol.toPrimitive](): string; toString(): string }
  | string
  | TrustedHtml
  | undefined
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
    }),
  );
}

/** @internal */
export interface DeferredRegionChunkCollector extends DeferredRegionCollector {
  chunks(): Promise<readonly DeferredStreamChunk[]>;
}

/** @internal */
export function createDeferredRegionChunkCollector(): DeferredRegionChunkCollector {
  const chunks: Promise<DeferredStreamChunk>[] = [];
  return {
    add(chunk) {
      chunks.push(Promise.resolve(chunk));
    },
    async chunks() {
      return Promise.all(chunks);
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
}

function lowerDeferredRegion<Input>(
  options: LowerDeferredRegionOptions<Input>,
): MaybePromise<RenderedHtml> {
  const priority = options.priority ?? 'critical';
  const renderRegion = () => {
    const value = options.render();
    return isPromiseLike(value)
      ? value.then((resolved) => options.renderRegion(resolved))
      : options.renderRegion(value);
  };
  const renderNow = () => rendered(renderRegion());
  if (priority === 'critical') return renderNow();

  const collector = currentJsxFrameworkContext()?.deferredRegions;
  if (!collector) return renderNow();

  collector.add(
    Promise.resolve(renderRegion()).then((html) => ({
      fragments: [
        {
          html,
          priority: deferredStreamPriority(priority),
          ...(options.stylesheets === undefined ? {} : { stylesheets: options.stylesheets }),
          target: options.target,
        },
      ],
      priority: deferredStreamPriority(priority),
    })),
  );

  return rendered(
    Promise.resolve(options.renderFallback(options.fallback)).then((fallback) =>
      placeholder(options.target, priority, fallback),
    ),
  );
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
): string {
  return `<kovo-defer target="${escapeAttribute(target)}" state="pending" data-kovo-region-priority="${escapeAttribute(priority)}">${fallback}</kovo-defer>`;
}

function rendered(value: MaybePromise<string>): MaybePromise<RenderedHtml> {
  return isPromiseLike(value) ? value.then((html) => renderedHtml(html)) : renderedHtml(value);
}

function unrendered(value: MaybePromise<RenderedHtml>): MaybePromise<string> {
  return isPromiseLike(value) ? value.then((html) => html.html) : value.html;
}

function isPromiseLike<Value>(value: unknown): value is PromiseLike<Value> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
