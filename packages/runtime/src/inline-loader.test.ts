import { runInThisContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

import {
  createInlineJisoLoaderSource,
  inlineJisoLoaderInstallerSource,
  jisoLoaderSource,
} from './inline-loader.js';
import { createInlineJisoLoaderSource as createPublicInlineJisoLoaderSource } from './index.js';

describe('inline loader source', () => {
  it('wraps the extracted installer source as the public bootstrap source', () => {
    // SPEC.md §4.4: the generated bootstrap is the always-loaded runtime path.
    expect(jisoLoaderSource).toBe(`(${inlineJisoLoaderInstallerSource})((url)=>import(url));`);
    expect(createPublicInlineJisoLoaderSource()).toBe(jisoLoaderSource);
    expect(gzipSync(jisoLoaderSource).byteLength).toBeLessThanOrEqual(4096);
  });

  it('keeps minified wire-contract tokens pinned in the extracted installer', () => {
    // SPEC.md §4.4: inline and modular loaders must not drift on query/fragment wire effects.
    expect(inlineJisoLoaderInstallerSource).toBe(inlineJisoLoaderInstallerSource.trim());
    expect(inlineJisoLoaderInstallerSource).not.toMatch(/\n|\s{2,}/);
    expect(inlineJisoLoaderInstallerSource).toContain("join('; ')");
    expect(inlineJisoLoaderInstallerSource).toContain("key:query.getAttribute('key')??undefined");
    expect(inlineJisoLoaderInstallerSource).toContain(
      "element.getAttribute('fw-fragment-target')??element.id",
    );
    expect(inlineJisoLoaderInstallerSource).toContain("getAttribute('fw-param-types')");
  });

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

      expect([...listeners.keys()]).toEqual(['click', 'submit', 'input', 'change']);
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
