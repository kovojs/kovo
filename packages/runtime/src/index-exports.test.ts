import { describe, expect, it } from 'vitest';

import * as root from './index.js';
import * as client from './client.js';
import * as generated from './generated.js';
import * as inlineLoader from './internal/inline-loader.js';
import * as output from './internal/output.js';
import { derive } from './derive.js';
import { handler } from './handlers.js';
import { tempId } from './optimism.js';
import { trustedHtml } from './security-output.js';

describe('runtime public export boundaries', () => {
  it('keeps the root to app-authored primitives', () => {
    // SPEC.md §4.3, §4.8, and §10.4 define the author-written client helpers.
    expect(root.derive).toBe(derive);
    expect(root.handler).toBe(handler);
    expect(root.tempId).toBe(tempId);
    expect(root.trustedHtml).toBe(trustedHtml);

    expect(Object.keys(root).sort()).toEqual(['derive', 'handler', 'tempId', 'trustedHtml']);
  });

  it('moves browser client machinery to the client subpath', () => {
    expect(client.applyDeferredStreamResponseToRuntime).toBe(
      generated.applyDeferredStreamResponseToRuntime,
    );
    expect(client.applyCompiledQueryUpdatePlan).toBe(generated.applyCompiledQueryUpdatePlan);
    expect(client.createQueryStore).toBe(generated.createQueryStore);
    expect(client.installKovoLoader).toBe(generated.installKovoLoader);
    expect(Object.hasOwn(root, 'installKovoLoader')).toBe(false);
    expect(Object.hasOwn(root, 'createQueryStore')).toBe(false);
    expect(Object.hasOwn(root, 'applyCompiledQueryUpdatePlan')).toBe(false);
    expect(Object.hasOwn(root, 'applyDeferredStreamResponseToRuntime')).toBe(false);
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
