import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
  assertMinifiedInlineKovoLoaderInstallerResponseApplyParity,
  assertMinifiedInlineKovoLoaderInstallerWireParserParity,
  inlineKovoLoaderGzipByteBudget,
} from './inline-loader-build.js';
import { inlineKovoLoaderInstallerSource, kovoLoaderSource } from './inline-loader.js';
import { createInlineKovoLoaderSource as createPublicInlineKovoLoaderSource } from './index.js';

describe('inline loader minified artifact', () => {
  it('wraps the extracted installer source as the public bootstrap source', () => {
    // SPEC.md §4.4: the generated bootstrap is the always-loaded runtime path.
    expect(kovoLoaderSource).toBe(`(${inlineKovoLoaderInstallerSource})((url)=>import(url));`);
    expect(createPublicInlineKovoLoaderSource()).toBe(kovoLoaderSource);
    expect(gzipSync(kovoLoaderSource).byteLength).toBeLessThanOrEqual(
      inlineKovoLoaderGzipByteBudget,
    );
    expect(kovoLoaderSource).toBe(kovoLoaderSource.trim());
    expect(kovoLoaderSource).not.toMatch(/\n|\s{2,}/);
    expect(kovoLoaderSource).toMatch(
      /^\(function installInlineKovoLoader\(\w+\)\{.*\}\)\(\(url\)=>import\(url\)\);$/,
    );
  });

  it('keeps the shipped minified parser helper tied to the canonical runtime parser', () => {
    // SPEC.md §4.4/§9.1: inline and modular loaders must share query/fragment wire scanning.
    expect(inlineKovoLoaderInstallerSource).toBe(inlineKovoLoaderInstallerSource.trim());
    expect(inlineKovoLoaderInstallerSource).not.toMatch(/\n|\s{2,}/);
    expect(() =>
      assertMinifiedInlineKovoLoaderInstallerWireParserParity(inlineKovoLoaderInstallerSource),
    ).not.toThrow();
    expect(inlineKovoLoaderInstallerSource).toContain("join('; ')");
    expect(inlineKovoLoaderInstallerSource).toContain('[...new Set(');
    expect(inlineKovoLoaderInstallerSource).toContain(
      'function readInlineMutationResponseBodyChunks(',
    );
    expect(inlineKovoLoaderInstallerSource).not.toContain('readChunks(');
    expect(inlineKovoLoaderInstallerSource).not.toContain("readAttribute(query.attrs,'name')");
    expect(inlineKovoLoaderInstallerSource).not.toContain('queryBody');
    expect(inlineKovoLoaderInstallerSource).toContain(
      "el.getAttribute('kovo-fragment-target')??el.id??el.getAttribute('kovo-c')",
    );
    // Security finding M10: the fragment-target lookup guards its querySelector
    // calls so a malformed wire target degrades to "no target found" instead of
    // throwing and aborting the apply pass.
    expect(inlineKovoLoaderInstallerSource).toContain(
      "const ft=(target)=>{try{return(doc.querySelector('[kovo-c=\"'+target+'\"]')??doc.getElementById(target)??doc.querySelector('[kovo-fragment-target=\"'+target+'\"]'));}catch{return;}};",
    );
    expect(inlineKovoLoaderInstallerSource).toContain("getAttribute('kovo-param-types')");
    expect(inlineKovoLoaderInstallerSource).not.toContain('DOMParser');
    expect(inlineKovoLoaderInstallerSource).not.toContain('Math.random');
  });

  it('keeps the shipped minified response apply helper tied to the canonical runtime apply helper', () => {
    // SPEC.md §4.4/§9.1: inline apply must stay on the generated response helper.
    expect(inlineKovoLoaderInstallerSource).toBe(inlineKovoLoaderInstallerSource.trim());
    expect(inlineKovoLoaderInstallerSource).not.toMatch(/\n|\s{2,}/);
    expect(() =>
      assertMinifiedInlineKovoLoaderInstallerResponseApplyParity(inlineKovoLoaderInstallerSource),
    ).not.toThrow();
    expect(inlineKovoLoaderInstallerSource).toContain(
      'function applyInlineMutationResponseChunks(',
    );
    expect(inlineKovoLoaderInstallerSource).not.toContain(
      'function applyInlineMutationResponseBody(',
    );
    expect(inlineKovoLoaderInstallerSource).toContain(
      'const dq=(type,init)=>{dispatchEvent(new CustomEvent(type,init));};',
    );
    expect(inlineKovoLoaderInstallerSource).toContain(
      "dq('kovo:query',{detail:{['quer'+'ies']:chunks.qs,},});",
    );
    expect(inlineKovoLoaderInstallerSource).toContain(
      "for(const x of chunks.fragments){if(x.mode==='append')continue;const e=ft(x.target);if(e)for(const y of qa(e,'[kovo-c]')){if(x.html.includes(y.getAttribute('kovo-c')))continue;y.a?.abort();}}applyInlineMutationResponseChunks(chunks,{findFragmentTarget:ft});",
    );
    expect(inlineKovoLoaderInstallerSource).toContain('function m(c,n)');
    expect(inlineKovoLoaderInstallerSource).toContain(
      'return p(chunks.fragments,(target)=>options.findFragmentTarget(target))',
    );
    expect(inlineKovoLoaderInstallerSource).toContain('function p(fs,f)');
    expect(inlineKovoLoaderInstallerSource).toContain("getAttribute('kovo-key')");
    expect(inlineKovoLoaderInstallerSource).not.toContain('innerHTML=html');
    expect(inlineKovoLoaderInstallerSource).not.toContain('applyResponseChunks');
    expect(inlineKovoLoaderInstallerSource).toContain("detail:{['quer'+'ies']:chunks.qs,}");
  });
});
