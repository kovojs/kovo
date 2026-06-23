import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
  assertMinifiedInlineKovoLoaderInstallerResponseApplyParity,
  assertMinifiedInlineKovoLoaderInstallerWireParserParity,
  inlineKovoLoaderGzipByteBudget,
} from './inline-loader-build.js';
import {
  inlineKovoLoaderBootstrapInstallerSource,
  inlineKovoLoaderInstallerSource,
  kovoDeferredRuntimeModulePath,
  kovoDeferredRuntimeModuleSource,
  kovoLoaderSource,
} from './inline-loader.js';
import { createInlineKovoLoaderSource as createPublicInlineKovoLoaderSource } from './internal/inline-loader.js';

describe('inline loader minified artifact', () => {
  it('wraps the tiny bootstrap as the public first-load source', () => {
    // SPEC.md §4.4: the generated bootstrap is the always-loaded path; the full
    // loader moves to the versioned runtime module.
    expect(kovoLoaderSource).toBe(
      `(${inlineKovoLoaderBootstrapInstallerSource})(${JSON.stringify(kovoDeferredRuntimeModulePath)},(url)=>import(url));`,
    );
    expect(createPublicInlineKovoLoaderSource()).toBe(kovoLoaderSource);
    expect(gzipSync(kovoLoaderSource).byteLength).toBeLessThanOrEqual(
      inlineKovoLoaderGzipByteBudget,
    );
    expect(kovoLoaderSource).toBe(kovoLoaderSource.trim());
    expect(kovoLoaderSource).not.toMatch(/\n|\s{2,}/);
    expect(kovoLoaderSource).toMatch(
      /^\(function installInlineKovoBootstrap\(\w+,\w+\)\{.*\}\)\("\/c\/kovo-runtime\.client\.js",\(url\)=>import\(url\)\);$/,
    );
    expect(kovoDeferredRuntimeModuleSource).toContain(
      `const install=(${inlineKovoLoaderInstallerSource});`,
    );
    expect(kovoDeferredRuntimeModuleSource).toContain('installKovoDeferredRuntime');
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
    expect(inlineKovoLoaderInstallerSource).toContain('function ri(');
    expect(inlineKovoLoaderInstallerSource).not.toContain('readChunks(');
    expect(inlineKovoLoaderInstallerSource).not.toContain("readAttribute(query.attrs,'name')");
    expect(inlineKovoLoaderInstallerSource).not.toContain('queryBody');
    expect(inlineKovoLoaderInstallerSource).toContain(
      "el.getAttribute('kovo-fragment-target')??el.getAttribute('id')??el.getAttribute('kovo-c')",
    );
    expect(inlineKovoLoaderInstallerSource).toContain(
      'const hsaf=(value)=>value&&!/[\\x00-\\x1f\\x7f\\s;,#=]/.test(value);',
    );
    expect(inlineKovoLoaderInstallerSource).toContain(
      "const hsc=(value)=>hsaf(value)&&!value.includes(':');",
    );
    // SPEC.md §9.1 + security finding M10: the fragment-target lookup uses the
    // same escaped precedence as the modular runtime and still guards
    // querySelector so malformed selectors cannot abort the apply pass.
    expect(inlineKovoLoaderInstallerSource).toContain(
      "const ft=(target)=>{try{const selectorTarget=sq(target);return(doc.querySelector('[kovo-fragment-target=\"'+selectorTarget+'\"]')??doc.getElementById(target)??doc.querySelector('[id=\"'+selectorTarget+'\"]')??doc.querySelector('[kovo-c=\"'+selectorTarget+'\"]')??doc.querySelector('kovo-defer[target=\"'+selectorTarget+'\"]'));}catch{return;}};",
    );
    expect(inlineKovoLoaderInstallerSource).toContain("getAttribute('kovo-param-types')");
    expect(inlineKovoLoaderInstallerSource).toContain('new DOMParser().parseFromString');
    expect(inlineKovoLoaderInstallerSource).toContain("'[kovo-nav-segment]'");
    expect(inlineKovoLoaderInstallerSource).not.toContain('Math.random');
  });

  it('keeps the shipped minified response apply helper tied to the canonical runtime apply helper', () => {
    // SPEC.md §4.4/§9.1: inline apply must stay on the generated response helper.
    expect(inlineKovoLoaderInstallerSource).toBe(inlineKovoLoaderInstallerSource.trim());
    expect(inlineKovoLoaderInstallerSource).not.toMatch(/\n|\s{2,}/);
    expect(() =>
      assertMinifiedInlineKovoLoaderInstallerResponseApplyParity(inlineKovoLoaderInstallerSource),
    ).not.toThrow();
    expect(inlineKovoLoaderInstallerSource).toContain('function ai(');
    expect(inlineKovoLoaderInstallerSource).not.toContain(
      'function applyInlineMutationResponseBody(',
    );
    expect(inlineKovoLoaderInstallerSource).toContain(
      'const dq=(type,init)=>{dispatchEvent(new CustomEvent(type,init));};',
    );
    expect(inlineKovoLoaderInstallerSource).toContain("dq('kovo:query',{detail:{qs:ok}});");
    expect(inlineKovoLoaderInstallerSource).toContain(
      `for(const x of fragments){if(x.mode==='append')continue;const e=ft(x.target);if(e)for(const y of qa(e,'[kovo-c]')){if(x.html.includes('kovo-c="'+y.getAttribute('kovo-c')+'"')&&(!y.getAttribute('kovo-key')&&!y.getAttribute('id')||x.html.includes('kovo-key="'+y.getAttribute('kovo-key')+'"')||x.html.includes('id="'+y.getAttribute('id')+'"')))continue;y.a?.abort();}}ai({fragments},{ff:ft});`,
    );
    expect(inlineKovoLoaderInstallerSource).toContain('function m(c,n)');
    expect(inlineKovoLoaderInstallerSource).toContain(
      'return p(chunks.fragments,(target)=>options.ff(target))',
    );
    expect(inlineKovoLoaderInstallerSource).toContain('function p(fs,f)');
    expect(inlineKovoLoaderInstallerSource).toContain("getAttribute('kovo-key')");
    expect(inlineKovoLoaderInstallerSource).not.toContain('innerHTML=html');
    expect(inlineKovoLoaderInstallerSource).not.toContain('applyResponseChunks');
    expect(inlineKovoLoaderInstallerSource).toContain('detail:{qs:ok}');
  });
});
