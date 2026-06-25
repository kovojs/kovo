import { describe, expect, it } from 'vitest';

import type {
  StructuralMorphBrowserState,
  StructuralMorphKey,
  StructuralMorphNode,
} from './client.js';
import * as root from './index.js';
import * as client from './client.js';
import * as generated from './generated.js';
import * as inlineLoader from './internal/inline-loader.js';
import * as output from './internal/output.js';
import { derive } from './derive.js';
import { handler } from './handlers.js';
import { tempId } from './optimism.js';
import { safeRichHtml, trustedHtml, trustedUrl } from './security-output.js';

describe('runtime public export boundaries', () => {
  it('keeps the root to app-authored primitives', () => {
    // SPEC.md §4.3, §4.8, and §10.4 define the author-written client helpers.
    expect(root.derive).toBe(derive);
    expect(root.handler).toBe(handler);
    expect(root.tempId).toBe(tempId);
    expect(root.safeRichHtml).toBe(safeRichHtml);
    expect(root.trustedHtml).toBe(trustedHtml);
    expect(root.trustedUrl).toBe(trustedUrl);

    expect(Object.keys(root).sort()).toEqual([
      'derive',
      'handler',
      'safeRichHtml',
      'tempId',
      'trustedHtml',
      'trustedUrl',
    ]);
  });

  it('keeps the client subpath to the browser bootstrap value helpers', () => {
    // SPEC.md §§4.4, 9.1: an app entry installs the loader and query store and
    // builds the browser root; the loader engine internals are no longer here.
    expect(client.createQueryStore).toBe(generated.createQueryStore);
    expect(client.installKovoLoader).toBe(generated.installKovoLoader);
    expect(typeof client.createBrowserKovoRoot).toBe('function');
    expect(typeof client.defaultEnhancedFetch).toBe('function');

    expect(Object.keys(client).sort()).toEqual([
      'createBrowserKovoRoot',
      'createQueryStore',
      'defaultEnhancedFetch',
      'installKovoLoader',
    ]);

    expect(Object.hasOwn(root, 'installKovoLoader')).toBe(false);
    expect(Object.hasOwn(root, 'createQueryStore')).toBe(false);
  });

  it('keeps the structural-morph shape types public for hand-written conformance helpers', () => {
    // SPEC.md §9.1: the structural-morph shape types are consumed by
    // examples/commerce/src/app-test-helpers.ts. They are type-only exports
    // (no runtime value), so assert their assignability shape here.
    const key: StructuralMorphKey = 'k';
    const browserState: StructuralMorphBrowserState = { focused: true };
    const node: StructuralMorphNode = { type: 'div', key, browserState };
    expect(node.type).toBe('div');
    expect(node.key).toBe('k');
    expect(node.browserState?.focused).toBe(true);
  });

  it('moves the deferred-stream and query-binding ABI to the generated subpath only', () => {
    // SPEC.md §5.2: compiler-emitted apply helpers are generated ABI, not on the
    // app-facing client subpath.
    expect(typeof generated.applyDeferredStreamResponseToRuntime).toBe('function');
    expect(typeof generated.applyCompiledQueryUpdatePlan).toBe('function');
    expect(Object.hasOwn(client, 'applyDeferredStreamResponseToRuntime')).toBe(false);
    expect(Object.hasOwn(client, 'applyCompiledQueryUpdatePlan')).toBe(false);
    expect(Object.hasOwn(client, 'createEventBus')).toBe(false);
    expect(Object.hasOwn(client, 'submitEnhancedMutation')).toBe(false);
    expect(Object.hasOwn(client, 'installMutationBroadcast')).toBe(false);
  });

  it('keeps inline-loader and generated output helpers off public app-authored surfaces', () => {
    expect(typeof inlineLoader.kovoLoaderSource).toBe('string');
    expect(output.kovoTrustedHtmlContent(trustedHtml('<b>x</b>'))).toBe('<b>x</b>');

    for (const name of [
      'kovoLoaderSource',
      'createInlineKovoLoaderSource',
      'kovoEscapeHtml',
      'kovoStyleProperty',
      'kovoTrustedHtmlContent',
    ]) {
      expect(Object.hasOwn(root, name)).toBe(false);
      expect(Object.hasOwn(client, name)).toBe(false);
    }
  });
});
