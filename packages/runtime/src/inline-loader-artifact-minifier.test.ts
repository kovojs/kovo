import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { inlineJisoLoaderGzipByteBudget } from './inline-loader-build.js';
import { inlineJisoLoaderInstallerSource, jisoLoaderSource } from './inline-loader.js';
import { createInlineJisoLoaderSource as createPublicInlineJisoLoaderSource } from './index.js';

describe('inline loader minified artifact', () => {
  it('wraps the extracted installer source as the public bootstrap source', () => {
    // SPEC.md §4.4: the generated bootstrap is the always-loaded runtime path.
    expect(jisoLoaderSource).toBe(`(${inlineJisoLoaderInstallerSource})((url)=>import(url));`);
    expect(createPublicInlineJisoLoaderSource()).toBe(jisoLoaderSource);
    expect(gzipSync(jisoLoaderSource).byteLength).toBeLessThanOrEqual(
      inlineJisoLoaderGzipByteBudget,
    );
    expect(jisoLoaderSource).toBe(jisoLoaderSource.trim());
    expect(jisoLoaderSource).not.toMatch(/\n|\s{2,}/);
    expect(jisoLoaderSource).toMatch(
      /^\(function installInlineJisoLoader\(importModule\)\{.*\}\)\(\(url\)=>import\(url\)\);$/,
    );
  });

  it('keeps minified parser wire-contract tokens pinned in the extracted installer', () => {
    // SPEC.md §4.4/§9.1: inline and modular loaders must share query/fragment wire scanning.
    expect(inlineJisoLoaderInstallerSource).toBe(inlineJisoLoaderInstallerSource.trim());
    expect(inlineJisoLoaderInstallerSource).not.toMatch(/\n|\s{2,}/);
    expect(inlineJisoLoaderInstallerSource).toContain("join('; ')");
    expect(inlineJisoLoaderInstallerSource).toContain('[...new Set(');
    expect(inlineJisoLoaderInstallerSource).toContain('function tagClose(');
    expect(inlineJisoLoaderInstallerSource).toContain(
      'function readMutationResponseElementChunks(',
    );
    expect(inlineJisoLoaderInstallerSource).toContain(
      'function readInlineMutationResponseBodyChunks(',
    );
    expect(inlineJisoLoaderInstallerSource).not.toContain('readChunks(');
    expect(inlineJisoLoaderInstallerSource).not.toContain("readAttribute(query.attrs,'name')");
    expect(inlineJisoLoaderInstallerSource).not.toContain('queryBody');
    expect(inlineJisoLoaderInstallerSource).toContain(
      "element.getAttribute('fw-fragment-target')??element.id",
    );
    expect(inlineJisoLoaderInstallerSource).toContain("getAttribute('fw-param-types')");
    expect(inlineJisoLoaderInstallerSource).not.toContain('DOMParser');
    expect(inlineJisoLoaderInstallerSource).not.toContain('Math.random');
  });

  it('keeps minified response-apply tokens pinned in the extracted installer', () => {
    // SPEC.md §4.4/§9.1: inline apply must stay on the generated response helper.
    expect(inlineJisoLoaderInstallerSource).toBe(inlineJisoLoaderInstallerSource.trim());
    expect(inlineJisoLoaderInstallerSource).not.toMatch(/\n|\s{2,}/);
    expect(inlineJisoLoaderInstallerSource).toContain(
      'function applyInlineMutationResponseChunks(',
    );
    expect(inlineJisoLoaderInstallerSource).not.toContain(
      'function applyInlineMutationResponseBody(',
    );
    expect(inlineJisoLoaderInstallerSource).toContain('function applyResponseFragment(');
    expect(inlineJisoLoaderInstallerSource).toContain('function appendInlineFragment(');
    expect(inlineJisoLoaderInstallerSource).toContain('function replaceInlineFragment(');
    expect(inlineJisoLoaderInstallerSource).toContain(
      'const dispatchQueries=(queries)=>{dispatchEvent(new CustomEvent',
    );
    expect(inlineJisoLoaderInstallerSource).toContain(
      'applyInlineMutationResponseChunks(readInlineMutationResponseBodyChunks(body),{dispatchQueries,findFragmentTarget,});',
    );
    expect(inlineJisoLoaderInstallerSource).toContain(
      'const appliedFragments=[];for(const fragment of chunks.fragments)',
    );
    expect(inlineJisoLoaderInstallerSource).toContain('return appliedFragments;');
    expect(inlineJisoLoaderInstallerSource).not.toContain('applyResponseChunks');
    expect(inlineJisoLoaderInstallerSource).toContain(
      'detail:{queries:queries.map((query)=>({attrs:query.attrs,content:query.content}))}',
    );
  });
});
