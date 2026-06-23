import { runInThisContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { createInlineKovoLoaderSource } from './inline-loader.js';

describe('inline loader source', () => {
  it('installs from a generated custom import expression without importing handlers eagerly', () => {
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const originals = {
      addEventListener: globalRecord.addEventListener,
      document: globalRecord.document,
      importModule: globalRecord.__kovoInlineImport,
      location: globalRecord.location,
      removeEventListener: globalRecord.removeEventListener,
      requestAnimationFrame: globalRecord.requestAnimationFrame,
    };
    const listeners = new Map<string, unknown>();
    const rafCallbacks: Function[] = [];
    const importModule = vi.fn(async () => ({}));

    try {
      globalRecord.__kovoInlineImport = importModule;
      globalRecord.addEventListener = (type: string, listener: unknown) => {
        listeners.set(type, listener);
      };
      globalRecord.removeEventListener = () => {};
      globalRecord.requestAnimationFrame = (callback: Function) => {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      };
      globalRecord.document = {
        querySelectorAll() {
          return [];
        },
      };
      globalRecord.location = { href: 'http://app.test/' };

      runInThisContext(createInlineKovoLoaderSource(' globalThis.__kovoInlineImport '));

      expect([...listeners.keys()]).toEqual(['click', 'submit']);
      expect(rafCallbacks).toHaveLength(2);
      expect(importModule).not.toHaveBeenCalled();
    } finally {
      Object.assign(globalRecord, {
        addEventListener: originals.addEventListener,
        document: originals.document,
        location: originals.location,
        removeEventListener: originals.removeEventListener,
        requestAnimationFrame: originals.requestAnimationFrame,
      });
      if (originals.importModule === undefined) {
        delete globalRecord.__kovoInlineImport;
      } else {
        globalRecord.__kovoInlineImport = originals.importModule;
      }
    }
  });
});
