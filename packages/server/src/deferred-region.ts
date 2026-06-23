import { escapeAttribute } from './html.js';
import type { DeferredPriority, DeferredStreamChunk } from './deferred-stream.js';
import type { StylesheetAsset } from './hints.js';
import { currentJsxFrameworkContext, type DeferredRegionCollector } from './jsx-context.js';

type MaybePromise<Value> = Promise<Value> | Value;

/** Priority for a server-rendered region inside the initial route document (SPEC §8). */
export type RegionPriority = 'after-paint' | 'critical';

/** Options for {@link defer}, the route-region deferral helper. */
export interface DeferredRegionOptions {
  /** Stable fragment target that the deferred stream will morph into. */
  target: string;
  /** Placeholder HTML kept in the initial shell until the region arrives. */
  fallback?: string;
  /** Region priority. `critical` renders immediately; `after-paint` streams after the shell. */
  priority?: RegionPriority;
  /** Render the real region HTML from server truth. */
  render: () => MaybePromise<string>;
  /** Stylesheets required by the deferred region when it is inserted. */
  stylesheets?: readonly (string | StylesheetAsset)[];
}

/**
 * Defer a route region until after the initial document shell.
 *
 * Inside normal route document rendering, `defer({ priority: 'after-paint' })`
 * returns a `<kovo-defer>` placeholder and records a fragment stream chunk that
 * arrives later in the same document response. Outside that document context,
 * including mutation fragment renders, it renders the full region immediately so
 * refreshes remain complete and no region silently disappears.
 */
export function defer(options: DeferredRegionOptions): MaybePromise<string> {
  const priority = options.priority ?? 'critical';
  if (priority === 'critical') return options.render();

  const collector = currentJsxFrameworkContext()?.deferredRegions;
  if (!collector) return options.render();

  collector.add(
    Promise.resolve(options.render()).then((html) => ({
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

  const fallback = options.fallback ?? '';
  return `<kovo-defer target="${escapeAttribute(options.target)}" state="pending" data-kovo-region-priority="${escapeAttribute(priority)}">${fallback}</kovo-defer>`;
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
  }
}
