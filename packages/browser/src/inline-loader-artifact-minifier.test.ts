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
    expect(inlineKovoLoaderInstallerSource).toContain("sj(rlt(),'; ')");
    expect(inlineKovoLoaderInstallerSource).toContain("sj(rt(),'; ')");
    expect(inlineKovoLoaderInstallerSource).not.toContain(".join('; ')");
    expect(inlineKovoLoaderInstallerSource).not.toContain('[...new Set(');
    expect(inlineKovoLoaderInstallerSource).toContain('function ri(');
    expect(inlineKovoLoaderInstallerSource).not.toContain('readChunks(');
    expect(inlineKovoLoaderInstallerSource).not.toContain("readAttribute(query.attrs,'name')");
    expect(inlineKovoLoaderInstallerSource).not.toContain('queryBody');
    expect(inlineKovoLoaderInstallerSource).toContain(
      "ras(el,'kovo-fragment-target')??ras(el,'id')??ras(el,'kovo-c')",
    );
    expect(inlineKovoLoaderInstallerSource).toContain(
      'const hsaf=(value)=>value&&!bns.regExpTest(/[\\x00-\\x1f\\x7f\\s;,#=]/,value);',
    );
    expect(inlineKovoLoaderInstallerSource).toContain(
      "const hsc=(value)=>hsaf(value)&&bns.indexOf(value,':')<0;",
    );
    // SPEC.md §9.1 + security finding M10: the fragment-target lookup uses the
    // same escaped precedence as the modular runtime and still guards
    // querySelector so malformed selectors cannot abort the apply pass.
    expect(inlineKovoLoaderInstallerSource).toContain('bns.getElementById(root,target)');
    expect(inlineKovoLoaderInstallerSource).toContain(
      "bns.queryOne(root,'[kovo-fragment-target=\"'+selectorTarget+'\"]')",
    );
    expect(inlineKovoLoaderInstallerSource).not.toContain('root.querySelector?.');
    expect(inlineKovoLoaderInstallerSource).toContain("ras(el,'kovo-param-types')");
    expect(inlineKovoLoaderInstallerSource).not.toContain('new DOMParser().parseFromString');
    expect(inlineKovoLoaderInstallerSource).toContain(
      'parseHtmlDocument:(value)=>bns.parseHtmlDocument(value)',
    );
    expect(inlineKovoLoaderInstallerSource).toContain("'[kovo-nav-segment]'");
    expect(inlineKovoLoaderInstallerSource).not.toContain('Math.random');
  });

  it('keeps bfcache persisted reads on the boot-witnessed browser controls', () => {
    // C136 / SPEC §8: both visible-return recovery and the session-dependent
    // reload defense consume the captured WebIDL getter, never event.persisted.
    expect(inlineKovoLoaderInstallerSource).toContain(
      'readPageTransitionPersisted:(event)=>bns.readPageTransitionPersisted(event)',
    );
    expect(inlineKovoLoaderInstallerSource).toContain(
      'if(readPageTransitionPersisted(event))visibleReturnRefresh()',
    );
    expect(inlineKovoLoaderInstallerSource).toContain(
      'if(readPageTransitionPersisted(event))reload()',
    );
    expect(inlineKovoLoaderInstallerSource).not.toContain('if(event.persisted)');
  });

  it('keeps bfcache enrollment on boot-witnessed document and EventTarget controls', () => {
    // C183 / SPEC §6.6/§8: the generated deferred runtime must not fall back to live
    // `document.querySelector` or global `addEventListener` for the session guard.
    expect(inlineKovoLoaderInstallerSource).toContain(
      'addLifecycleEventListener:(type,listener)=>bns.addLifecycleEventListener(globalThis,type,listener)',
    );
    expect(inlineKovoLoaderInstallerSource).toContain('queryOne:(root,sl)=>bns.queryOne(root,sl)');
    expect(inlineKovoLoaderInstallerSource).toContain(
      'if(queryOne(doc,\'meta[name="kovo-session"]\'))',
    );
    expect(inlineKovoLoaderInstallerSource).not.toContain(
      'if(doc.querySelector?.(\'meta[name="kovo-session"]\'))',
    );
    expect(inlineKovoLoaderInstallerSource).toContain(
      'const sessionMeta=bns.queryOne(doc,\'meta[name="kovo-session"]\')',
    );
    expect(inlineKovoLoaderInstallerSource).toContain(
      'const meta=bns.queryOne(root,\'meta[name="kovo-build"]\')',
    );
    expect(inlineKovoLoaderInstallerSource).not.toContain(
      'root.querySelector?.(\'meta[name="kovo-build"]\')',
    );
    expect(inlineKovoLoaderInstallerSource).toContain(
      "bns.queryAllElements(doc,'[data-kovo-module-allowlist]')",
    );
    expect(inlineKovoLoaderInstallerSource).not.toContain(
      "for(const a of bns.queryAllElements(doc,'[data-kovo-module-allowlist]'))",
    );
    expect(inlineKovoLoaderInstallerSource).not.toContain("qa(doc,'[data-kovo-module-allowlist]')");
  });

  it('keeps mutation broadcast envelopes on the immutable MessageEvent snapshot', () => {
    // C137 / SPEC §9.3: the principal comparison and private wire body must
    // originate from one boot-read snapshot, and C164 keeps the application
    // callback behind the witnessed setter rather than a live assignment.
    expect(inlineKovoLoaderInstallerSource).toContain(
      'bns.setMutationBroadcastMessageHandler(bc,(event)=>{if(broadcastRetired)return;const data=bns.snapshotMutationBroadcastEnvelope(event);if(broadcastRetired||!data||data.principal!==sfp)return;ab(data.body,data.buildToken);},()=>broadcastRetired)',
    );
    expect(inlineKovoLoaderInstallerSource).not.toContain('const data=event.data');
    expect(inlineKovoLoaderInstallerSource).not.toContain('bmsg(');
    expect(inlineKovoLoaderInstallerSource).not.toContain('bc.onmessage=(event)');
  });

  it('keeps mutation broadcast publish on the witnessed exact-envelope controls', () => {
    // C151 / SPEC §9.1/§9.3: constructor and publish authority stay inside the
    // boot-witnessed membrane, and postMessage only receives the exact snapshot.
    expect(inlineKovoLoaderInstallerSource).toContain(
      "bc=bns.createMutationBroadcastChannel('kovo:mutation-response')",
    );
    expect(inlineKovoLoaderInstallerSource).toContain(
      'const envelope=bns.snapshotMutationBroadcastEnvelopeData({body,',
    );
    expect(inlineKovoLoaderInstallerSource).toContain(
      'bns.observePromiseRejection(bns.postMutationBroadcastEnvelope(bc,envelope,()=>broadcastRetired))',
    );
    expect(inlineKovoLoaderInstallerSource).not.toContain('new BroadcastChannel(');
    expect(inlineKovoLoaderInstallerSource).not.toContain('bc.postMessage(');
  });

  it('retires mutation broadcast authority before pinned platform cleanup', () => {
    // C171 / SPEC §9.3: session-change retirement is synchronous and local;
    // late prototype clear/close wrappers are not consulted by the artifact.
    expect(inlineKovoLoaderInstallerSource).toContain(
      'function retireBroadcast(){if(broadcastRetired)return;broadcastRetired=true;const channel=bc;bc=undefined;if(channel)bns.retireMutationBroadcastChannel(channel);}',
    );
    expect(inlineKovoLoaderInstallerSource).not.toContain('bc.onmessage=null');
    expect(inlineKovoLoaderInstallerSource).not.toContain('bc.close?.()');
  });

  it('retires the mutation principal before empty-auth fallback navigation', () => {
    // C176 / SPEC §9.3: navigation can be delayed or cancelled, so the accepted
    // Kovo-Changes auth fallback must cut the old channel before consulting it.
    expect(inlineKovoLoaderInstallerSource).toContain(
      'if(eaf(res,changes,text)){retireBroadcast();ng(ant(form,body));return;}',
    );
    expect(inlineKovoLoaderInstallerSource).not.toContain(
      'if(eaf(res,changes,text)){ng(ant(form,body));return;}',
    );
  });

  it('retires the expired mutation principal before reauth navigation', () => {
    // C180 / SPEC §6.5/§9.3: a 401 Kovo-Reauth is an expired-session
    // transition, and the sanitized login navigation cannot own retirement.
    expect(inlineKovoLoaderInstallerSource).toContain(
      "if(status===401&&reauth){retireBroadcast();ng(bns.safeSameOriginPath(reauth)||'/');return;}",
    );
    expect(inlineKovoLoaderInstallerSource).not.toContain(
      "if(status===401&&reauth){ng(bns.safeSameOriginPath(reauth)||'/');return;}",
    );
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
      `for(const x of fragments){if(x.mode==='append')continue;const e=ft(x.target);if(e)for(const y of qa(e,'[kovo-c]')){const html=renderedFragmentHtmlContent(x.html);if(html.includes('kovo-c="'+y.getAttribute('kovo-c')+'"')&&(!y.getAttribute('kovo-key')&&!y.getAttribute('id')||html.includes('kovo-key="'+y.getAttribute('kovo-key')+'"')||html.includes('id="'+y.getAttribute('id')+'"')))continue;y.a?.abort();}}ai({fragments},{createHTML:(html)=>tts.createHTML(html),ff:ft,security:bns});`,
    );
    expect(inlineKovoLoaderInstallerSource).toContain('function m(c,n,security)');
    expect(inlineKovoLoaderInstallerSource).toContain(
      'return p(chunks.fragments,(target)=>options.ff(target),options.security,(html)=>options.createHTML(html))',
    );
    expect(inlineKovoLoaderInstallerSource).toContain('function p(fs,f,security,createHTML)');
    expect(inlineKovoLoaderInstallerSource).toContain('morph:(cur,next)=>m(cur,next,bns)');
    expect(inlineKovoLoaderInstallerSource).toContain(
      'const rr=await bns.acquireStreamReader(body)',
    );
    expect(inlineKovoLoaderInstallerSource).toContain('await bns.readStreamChunk(rr)');
    expect(inlineKovoLoaderInstallerSource).toContain('bns.cancelStreamReader(src)');
    expect(inlineKovoLoaderInstallerSource).toContain('bns.cancelReadableStream(src)');
    expect(inlineKovoLoaderInstallerSource).toContain('bns.releaseStreamReader(rr)');
    expect(inlineKovoLoaderInstallerSource).not.toContain('body.getReader()');
    expect(inlineKovoLoaderInstallerSource).not.toContain('rr.read()');
    expect(inlineKovoLoaderInstallerSource).not.toContain('rr.releaseLock');
    expect(inlineKovoLoaderInstallerSource).toContain("getAttribute('kovo-key')");
    expect(inlineKovoLoaderInstallerSource).not.toContain('innerHTML=html');
    expect(inlineKovoLoaderInstallerSource).not.toContain('applyResponseChunks');
    expect(inlineKovoLoaderInstallerSource).toContain('detail:{qs:ok}');
  });
});
