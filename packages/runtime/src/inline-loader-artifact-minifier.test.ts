import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
  assertMinifiedInlineJisoLoaderInstallerResponseApplyParity,
  assertMinifiedInlineJisoLoaderInstallerWireParserParity,
  inlineJisoLoaderGzipByteBudget,
} from './inline-loader-build.js';
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
      /^\(function installInlineJisoLoader\(\w+\)\{.*\}\)\(\(url\)=>import\(url\)\);$/,
    );
  });

  it('keeps the shipped minified parser helper tied to the canonical runtime parser', () => {
    // SPEC.md §4.4/§9.1: inline and modular loaders must share query/fragment wire scanning.
    expect(inlineJisoLoaderInstallerSource).toBe(inlineJisoLoaderInstallerSource.trim());
    expect(inlineJisoLoaderInstallerSource).not.toMatch(/\n|\s{2,}/);
    expect(() =>
      assertMinifiedInlineJisoLoaderInstallerWireParserParity(inlineJisoLoaderInstallerSource),
    ).not.toThrow();
    expect(inlineJisoLoaderInstallerSource).toContain("join('; ')");
    expect(inlineJisoLoaderInstallerSource).toContain('[...new Set(');
    expect(inlineJisoLoaderInstallerSource).toContain(
      'function readInlineMutationResponseBodyChunks(',
    );
    expect(inlineJisoLoaderInstallerSource).not.toContain('readChunks(');
    expect(inlineJisoLoaderInstallerSource).not.toContain("readAttribute(query.attrs,'name')");
    expect(inlineJisoLoaderInstallerSource).not.toContain('queryBody');
    expect(inlineJisoLoaderInstallerSource).toContain(
      "el.getAttribute('fw-fragment-target')??el.id??el.getAttribute('fw-c')",
    );
    expect(inlineJisoLoaderInstallerSource).toContain(
      "const ft=(target)=>doc.querySelector('[fw-c=\"'+target+'\"]')??doc.getElementById(target)??doc.querySelector('[fw-fragment-target=\"'+target+'\"]');",
    );
    expect(inlineJisoLoaderInstallerSource).toContain("getAttribute('fw-param-types')");
    expect(inlineJisoLoaderInstallerSource).not.toContain('DOMParser');
    expect(inlineJisoLoaderInstallerSource).not.toContain('Math.random');
  });

  it('keeps the shipped minified response apply helper tied to the canonical runtime apply helper', () => {
    // SPEC.md §4.4/§9.1: inline apply must stay on the generated response helper.
    expect(inlineJisoLoaderInstallerSource).toBe(inlineJisoLoaderInstallerSource.trim());
    expect(inlineJisoLoaderInstallerSource).not.toMatch(/\n|\s{2,}/);
    expect(() =>
      assertMinifiedInlineJisoLoaderInstallerResponseApplyParity(inlineJisoLoaderInstallerSource),
    ).not.toThrow();
    expect(inlineJisoLoaderInstallerSource).toContain(
      'function applyInlineMutationResponseChunks(',
    );
    expect(inlineJisoLoaderInstallerSource).not.toContain(
      'function applyInlineMutationResponseBody(',
    );
    expect(inlineJisoLoaderInstallerSource).toContain(
      'const dq=(type,init)=>{dispatchEvent(new CustomEvent(type,init));};',
    );
    expect(inlineJisoLoaderInstallerSource).toContain(
      'applyInlineMutationResponseChunks(readInlineMutationResponseBodyChunks(body),{dispatchQueryEvent:dq,findFragmentTarget:ft,});',
    );
    expect(inlineJisoLoaderInstallerSource).toContain('function m(c,n)');
    expect(inlineJisoLoaderInstallerSource).toContain(
      'return p(chunks.fragments,(target)=>options.findFragmentTarget(target))',
    );
    expect(inlineJisoLoaderInstallerSource).toContain('function p(fs,f)');
    expect(inlineJisoLoaderInstallerSource).toContain("getAttribute('fw-key')");
    expect(inlineJisoLoaderInstallerSource).not.toContain('innerHTML=html');
    expect(inlineJisoLoaderInstallerSource).not.toContain('applyResponseChunks');
    expect(inlineJisoLoaderInstallerSource).toContain(
      'detail:{queries:chunks.queries.map((query)=>({attrs:query.attrs,content:query.content})),}',
    );
  });
});
