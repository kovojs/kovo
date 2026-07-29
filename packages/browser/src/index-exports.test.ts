import { describe, expect, it } from 'vitest';

import type {
  StructuralMorphBrowserState,
  StructuralMorphKey,
  StructuralMorphNode,
} from './generated.js';
import * as root from './index.js';
import * as client from './client.js';
import * as generated from './generated.js';
import * as inlineLoader from './internal/inline-loader.js';
import * as output from './internal/output.js';
import { derive } from './derive.js';
import { handler } from './handlers.js';
import { now, tempId } from './optimism.js';
import { safeRichHtml, trustedHtml, trustedUrl } from './security-output.js';

describe('runtime public export boundaries', () => {
  it('keeps the root to app-authored primitives', () => {
    // SPEC.md §4.3, §4.8, and §10.4 define the author-written client helpers.
    expect(root.derive).toBe(derive);
    expect(root.handler).toBe(handler);
    expect(root.safeRichHtml).toBe(safeRichHtml);
    expect(root.trustedHtml).toBe(trustedHtml);
    expect(root.trustedUrl).toBe(trustedUrl);

    expect(Object.keys(root).sort()).toEqual([
      'derive',
      'handler',
      'safeRichHtml',
      'trustedHtml',
      'trustedUrl',
    ]);
  });

  it('keeps the client subpath to one custom-shell installer', () => {
    // SPEC.md §§4.4, 5.2, 9.1: generated bootstrap owns runtime assembly;
    // a custom shell gets one installer rather than store/root/transport pieces.
    expect(typeof client.installKovoClient).toBe('function');
    expect(Object.keys(client)).toEqual(['installKovoClient']);

    expect(Object.hasOwn(root, 'installKovoLoader')).toBe(false);
    expect(Object.hasOwn(root, 'createQueryStore')).toBe(false);
    expect(Object.hasOwn(client, 'installKovoLoader')).toBe(false);
    expect(Object.hasOwn(client, 'createQueryStore')).toBe(false);
    expect(Object.hasOwn(client, 'createBrowserKovoRoot')).toBe(false);
    expect(Object.hasOwn(client, 'defaultEnhancedFetch')).toBe(false);

    expect(typeof generated.installKovoLoader).toBe('function');
    expect(typeof generated.createQueryStore).toBe('function');
    expect(typeof generated.createBrowserKovoRoot).toBe('function');
    expect(typeof generated.defaultEnhancedFetch).toBe('function');
  });

  it('keeps the structural-morph shape types on the generated ABI', () => {
    // SPEC.md §9.1: the structural-morph shape types are consumed by
    // generated/runtime conformance helpers. They are type-only exports (no
    // runtime value), so assert their assignability shape here.
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
    expect(typeof generated.runQueryUpdatePlan).toBe('function');
    expect(generated.now).toBe(now);
    expect(generated.tempId).toBe(tempId);
    expect(Object.hasOwn(client, 'applyDeferredStreamResponseToRuntime')).toBe(false);
    expect(Object.hasOwn(client, 'applyCompiledQueryUpdatePlan')).toBe(false);
    expect(Object.hasOwn(client, 'runQueryUpdatePlan')).toBe(false);
    expect(Object.hasOwn(root, 'now')).toBe(false);
    expect(Object.hasOwn(root, 'tempId')).toBe(false);
    expect(Object.hasOwn(client, 'createEventBus')).toBe(false);
    expect(Object.hasOwn(client, 'submitEnhancedMutation')).toBe(false);
    expect(Object.hasOwn(client, 'installMutationBroadcast')).toBe(false);
  });

  it('keeps inline-loader and generated output helpers off public app-authored surfaces', () => {
    expect(typeof inlineLoader.kovoLoaderSource).toBe('string');
    expect(
      output.kovoTrustedHtmlContent(
        trustedHtml('<b>x</b>', { reason: 'index export boundary fixture' }),
      ),
    ).toBe('<b>x</b>');

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
