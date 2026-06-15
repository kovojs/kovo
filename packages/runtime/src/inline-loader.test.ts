import { runInThisContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { createInlineJisoLoaderSource } from './inline-loader.js';

describe('inline loader source', () => {
  it('installs from a generated custom import expression without importing handlers eagerly', () => {
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const originals = {
      addEventListener: globalRecord.addEventListener,
      document: globalRecord.document,
      importModule: globalRecord.__jisoInlineImport,
    };
    const listeners = new Map<string, unknown>();
    const importModule = vi.fn(async () => ({}));

    try {
      globalRecord.__jisoInlineImport = importModule;
      globalRecord.addEventListener = (type: string, listener: unknown) => {
        listeners.set(type, listener);
      };
      globalRecord.document = {
        querySelectorAll() {
          return [];
        },
      };

      runInThisContext(createInlineJisoLoaderSource(' globalThis.__jisoInlineImport '));

      expect([...listeners.keys()]).toEqual([
        'click',
        'submit',
        'input',
        'change',
        'keydown',
        'keyup',
        'contextmenu',
        'paste',
        'cancel',
        'beforetoggle',
        'scroll',
        'focus',
        'blur',
        'pointerdown',
        'pointermove',
        'pointerup',
        'pointerover',
        'pointerout',
      ]);
      expect(importModule).not.toHaveBeenCalled();
    } finally {
      Object.assign(globalRecord, {
        addEventListener: originals.addEventListener,
        document: originals.document,
      });
      if (originals.importModule === undefined) {
        delete globalRecord.__jisoInlineImport;
      } else {
        globalRecord.__jisoInlineImport = originals.importModule;
      }
    }
  });
});
