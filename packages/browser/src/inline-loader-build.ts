import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import ts from 'typescript';

import { enhancedNavigationDocumentAcceptHeader } from '@kovojs/core/internal/document-protocol';

import { minifyInlineJavaScriptSource } from './inline-js-minifier.ts';

const inlineKovoLoaderModulePath = fileURLToPath(new URL('./inline-loader.ts', import.meta.url));
const modularLoaderSourcePath = fileURLToPath(new URL('./loader.ts', import.meta.url));
const fragmentTargetsSourcePath = fileURLToPath(new URL('./fragment-targets.ts', import.meta.url));
const inlineResponseApplySourcePath = fileURLToPath(
  new URL('./inline-response-apply.ts', import.meta.url),
);
const responseFragmentApplySourcePath = fileURLToPath(
  new URL('./response-fragment-apply.ts', import.meta.url),
);
const wireHtmlSourcePath = fileURLToPath(new URL('./wire-html.ts', import.meta.url));
const wireTokenizerSourcePath = fileURLToPath(new URL('./wire-tokenizer.ts', import.meta.url));
const wireResponseScannerSourcePath = fileURLToPath(
  new URL('./wire-response-scanner.ts', import.meta.url),
);
const enhancedNavigationSourcePath = fileURLToPath(
  new URL('./enhanced-navigation.ts', import.meta.url),
);
const navigationSecurityIntrinsicsSourcePath = fileURLToPath(
  new URL('./navigation-security-intrinsics.ts', import.meta.url),
);
const mutationIdemIntrinsicsSourcePath = fileURLToPath(
  new URL('./mutation-idem-intrinsics.ts', import.meta.url),
);
const documentLifecycleSourcePath = fileURLToPath(
  new URL('./document-lifecycle.ts', import.meta.url),
);

const inlineHelperSpecs = {
  fragmentTargetEscape: {
    label: 'fragment target escape',
    readableParityLabel: 'canonical fragment target escape helper closure',
    minifiedParityLabel: 'canonical minified fragment target escape helper closure',
    rootFunctionNames: ['escapeCssString'],
    sourceFileName: 'fragment-targets.ts',
    sourcePath: fragmentTargetsSourcePath,
    sourcePaths: [fragmentTargetsSourcePath],
  },
  responseApply: {
    label: 'response apply',
    readableParityLabel: 'canonical response apply helper closure',
    minifiedParityLabel: 'canonical minified response apply helper closure',
    rootFunctionNames: ['applyInlineMutationResponseChunks'],
    sourceFileName: 'inline-response-apply.ts',
    sourcePath: inlineResponseApplySourcePath,
    sourcePaths: [responseFragmentApplySourcePath, inlineResponseApplySourcePath],
  },
  wireParser: {
    label: 'wire parser',
    readableParityLabel: 'canonical wire parser helper closure',
    minifiedParityLabel: 'canonical minified wire parser helper closure',
    rootFunctionNames: ['readInlineMutationResponseBodyChunks'],
    sourceFileName: 'wire-response-scanner.ts',
    sourcePath: wireResponseScannerSourcePath,
    sourcePaths: [wireTokenizerSourcePath, wireHtmlSourcePath, wireResponseScannerSourcePath],
  },
  enhancedNavigation: {
    label: 'enhanced navigation',
    readableParityLabel: 'canonical enhanced navigation helper closure',
    minifiedParityLabel: 'canonical minified enhanced navigation helper closure',
    rootFunctionNames: [
      'createMutationIdemSecurityControls',
      'installEnhancedNavigationRuntime',
    ],
    sourceFileName: 'enhanced-navigation.ts',
    sourcePath: enhancedNavigationSourcePath,
    sourcePaths: [
      mutationIdemIntrinsicsSourcePath,
      navigationSecurityIntrinsicsSourcePath,
      enhancedNavigationSourcePath,
    ],
  },
  documentLifecycle: {
    label: 'document lifecycle',
    readableParityLabel: 'canonical document lifecycle helper closure',
    minifiedParityLabel: 'canonical minified document lifecycle helper closure',
    rootFunctionNames: ['createDocumentLifecycleRecovery'],
    sourceFileName: 'document-lifecycle.ts',
    sourcePath: documentLifecycleSourcePath,
    sourcePaths: [documentLifecycleSourcePath],
  },
} as const;

type InlineHelperSpec = (typeof inlineHelperSpecs)[keyof typeof inlineHelperSpecs];

// SPEC.md §4.4 always-loaded bootstrap gzip ceiling. This budget applies only to
// the document-shell bootstrap that captures first interactions and imports the
// deferred runtime. The deferred runtime module is versioned and cacheable, but
// intentionally not capped by this inline-byte budget.
export const inlineKovoLoaderGzipByteBudget = 10500;

export const inlineWireParserReadableSource = readInlineWireParserReadableSource();
export const inlineResponseApplyReadableSource = readInlineResponseApplyReadableSource();
export const inlineFragmentTargetEscapeReadableSource =
  readInlineFragmentTargetEscapeReadableSource();
export const inlineEnhancedNavigationReadableSource = readInlineEnhancedNavigationReadableSource();
export const inlineDocumentLifecycleReadableSource = readInlineDocumentLifecycleReadableSource();
export const inlineDelegatedEvents = readModularDefaultDelegatedEvents();
const inlineBooleanPresenceAttributes = [
  'checked',
  'disabled',
  'hidden',
  'indeterminate',
  'multiple',
  'open',
  'readonly',
  'required',
  'selected',
] as const;

export const inlineKovoLoaderInstallerReadableSource =
  buildInlineKovoLoaderInstallerReadableSource();
export const inlineKovoLoaderStubInstallerReadableSource =
  buildInlineKovoLoaderStubInstallerReadableSource();

export function buildInlineKovoLoaderInstallerReadableSource(
  wireParserReadableSource = inlineWireParserReadableSource,
  responseApplyReadableSource = inlineResponseApplyReadableSource,
  delegatedEvents: readonly string[] = inlineDelegatedEvents,
  fragmentTargetEscapeReadableSource = inlineFragmentTargetEscapeReadableSource,
  enhancedNavigationReadableSource = inlineEnhancedNavigationReadableSource,
  documentLifecycleReadableSource = inlineDocumentLifecycleReadableSource,
): string {
  return String.raw`
/* SPEC.md §4.4: this is the always-loaded bootstrap source. */
function installInlineKovoLoader(im) {
  // SPEC.md §4.4: delegate (capture phase) every on:* event the document uses.
  // focus/blur have no bubble phase but DO run a capture phase at ancestors, so
  // capture-phase delegation reaches them; pointerenter/pointerleave never run a
  // capture phase at ancestors, so they are synthesized below from pointerover/out.
  const events = ${JSON.stringify([...delegatedEvents])};
  const doc = document;
  const bns = createBrowserNavigationSecurityControls();
  const mis = createMutationIdemSecurityControls();
  const ci = () => mis.createMutationIdem();
  const rh = (el) =>
    el.closest?.('[kovo-state]') ?? (el.getAttribute?.('kovo-state') === null ? null : el);
  const rs = (el) => {
    try {
      return JSON.parse(rh(el)?.getAttribute('kovo-state') ?? '{}');
    } catch {
      return {};
    }
  };
  const qa = (root, selector) =>
    root.querySelectorAll ? [...root.querySelectorAll(selector)] : [];
  const xa = (current, next) => {
    for (let i = current.attributes.length; i--; ) {
      const attr = current.attributes[i];
      if (attr && !next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
    }
    for (const attr of next.attributes) current.setAttribute(attr.name, attr.value);
  };
  const xd = (current, next) => {
    let theme;
    try {
      theme = localStorage.getItem('theme');
    } catch {}
    const dark = theme === 'dark' || (theme !== 'light' && current.classList?.contains('dark'));
    const light = theme === 'light' || (theme !== 'dark' && current.classList?.contains('light'));
    xa(current, next);
    current.classList?.toggle('dark', dark);
    current.classList?.toggle('light', light && !dark);
    if (theme === 'dark' || theme === 'light') current.setAttribute('data-theme', theme);
  };
  const vp = (val, path) =>
    path.split('.').reduce((cur, seg) => {
      const key = seg.endsWith('?') ? seg.slice(0, -1) : seg;
      return typeof cur === 'object' && cur !== null ? cur[key] : undefined;
    }, val);
  const fb = (val) =>
    val == null ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
  const uu = (v) => {
    // SPEC.md §4.5/§4.8 KV236: scheme check must match the canonical regex in
    // core/internal/security-url.ts (/^([a-z][a-z0-9+.-]*):/) and the sibling
    // copy w in the deferred runtime (inline-loader.ts). The old /^[a-z][^:]*:/
    // wrongly treated relative URLs containing a colon after a slash (e.g.
    // "archive/2024:summary", "a/b:c") as scheme-bearing and rewrote them to '#'.
    const s = v.replace(/[\x00-\x20]/g, '').toLowerCase();
    return /^[a-z][a-z0-9+.-]*:/.test(s) && !/^(https?|ftp|mailto|tel):/.test(s);
  };
  const ia = (name) =>
    /^(href|src|action|formaction|poster|background|cite|data|ping|xlink:href)$/i.test(name);
  const s = (v) => {
    const r = [];
    for (const c of String(v).split(',')) {
      const x = c.trim();
      if (x && !uu(x.split(/\s/)[0])) r.push(x);
    }
    return r.length ? r.join(', ') : null;
  };
  const ki = (url) => {
    try {
      const l = globalThis.location || { href: 'http://localhost/', origin: 'http://localhost' };
      const p = new URL(url, l.href);
      if (p.origin !== l.origin) return false;
      const pn = p.pathname;
      if (
        p.protocol === 'http:' &&
        /^(?:localhost|127\.0\.0\.1|::1)$/.test(p.hostname) &&
        !pn.startsWith('/c/') &&
        /\.(?:[cm]?tsx?)$/.test(pn)
      ) {
        return true;
      }
      if (!pn.startsWith('/c/')) return false;
      const k = p.origin + pn + p.search;
      for (const a of qa(doc, '[data-kovo-module-allowlist]')) {
        const declared = a.getAttribute?.('data-kovo-module-allowlist') || a.getAttribute?.('href') || '';
        for (const href of declared.split(/\s+/).filter(Boolean)) {
          try {
            const u = new URL(href, l.href);
            if (u.origin === l.origin && u.pathname.startsWith('/c/') && u.origin + u.pathname + u.search === k) return true;
          } catch {}
        }
      }
      return false;
    } catch {
      return false;
    }
  };
  const oi = im;
  im = (url) => {
    if (!ki(url)) throw Error('Disallowed Kovo dynamic import URL: ' + url);
    return oi(url);
  };
  const sh = (el, host) =>
    el === host || !el.closest || el.closest('[kovo-state]') === host;
  const ba = (el) =>
    [...(el.attributes || [])].filter(
      (attr) => attr.name.startsWith('data-bind:') && attr.value,
    );
  const wa = (el, name, val) => {
    const n = name.toLowerCase();
    // SPEC.md section 5.2.4: a dialog opened via the native show-modal invoker
    // lives in the top layer. Toggling its open attribute alone never exits the
    // top layer (it stays :modal with an inert backdrop intercepting every
    // click), so drive the reactive open/close through the dialog methods that
    // keep top-layer state in sync. Guards keep this idempotent against the
    // native invoker call that opens the dialog on the same activation.
    if (name === 'open' && el.localName === 'dialog' && typeof el.close === 'function') {
      if (val != null && val !== false) {
        if (!el.open) {
          if (el.getAttribute?.('aria-modal') === 'true' && typeof el.showModal === 'function') {
            el.showModal();
          } else if (typeof el.show === 'function') el.show();
          else el.setAttribute('open', '');
        }
      } else if (el.open) el.close();
      return;
    }
    // SPEC.md §4.6/§4.8: HTML boolean-presence attributes use presence, not
    // stringified booleans. Keep inline data-bind:* in parity with the module
    // query/state runtime for the full boolean-presence set.
    if (/^(?:${inlineBooleanPresenceAttributes.join('|')})$/.test(n)) {
      const on = val != null && val !== false;
      if (on) el.setAttribute?.(name, '');
      else el.removeAttribute?.(name);
      if (n === 'checked' && el.checked !== undefined) el.checked = on;
      if (n === 'indeterminate' && el.indeterminate !== undefined) el.indeterminate = on;
      return;
    }
    if (val == null) el.removeAttribute?.(name);
    else {
      if (r(n)) el.removeAttribute?.(name);
      else {
        let r = fb(val);
        if (n === 'style' && c(r)) {
          el.removeAttribute?.(name);
        } else if (n === 'srcset' || n === 'imagesrcset') {
          const a = s(r);
          if (a) el.setAttribute?.(name, a);
          else el.removeAttribute?.(name);
        } else {
          if (ia(name) && uu(r)) r = '#';
          el.setAttribute?.(name, r);
        }
      }
    }
    if (name === 'value' && el.value !== undefined) {
      if (val != null) el.value = fb(val);
      else if (el.localName != 'progress') el.value = '';
    }
    if ((name === 'scrollLeft' || name === 'scrollleft') && el.scrollLeft !== undefined) {
      el.scrollLeft = Number(val) || 0;
    }
    if ((name === 'scrollTop' || name === 'scrolltop') && el.scrollTop !== undefined) {
      el.scrollTop = Number(val) || 0;
    }
  };
  const ws = (el, path, bt, state, root = 'state') => {
    if (!path?.startsWith(root + '.')) return;
    const val = vp(state, path.slice(root.length + 1));
    if (bt) {
      wa(el, bt, val);
    } else {
      // SPEC §4.8: data-bind is textContent; form values use data-bind:value.
      el.textContent = fb(val);
    }
  };
  const wd = async (el, ref, bt, state) => {
    const hi = ref.lastIndexOf('#');
    if (hi <= 0 || hi === ref.length - 1) return;
    const mod = await im(ref.slice(0, hi));
    const derive = mod[ref.slice(hi + 1)];
    const val = derive?.run?.(state);
    if (bt) {
      wa(el, bt, val);
    } else {
      // SPEC §4.8: derive text stamps share data-bind's textContent semantics.
      el.textContent = fb(val);
    }
  };
  // SPEC.md §4.8 data-bind-prop: closed allowlist of property-authoritative
  // props (lowercased suffix -> [cased prop, kind]); 0=bool,1=number,2=string.
  // The property write complements the SSR attribute and never reaches an unsafe
  // sink (KV236). bp(el) collects the stamps; wp writes one with coercion.
  const pa = {
    checked: ['checked', 0],
    indeterminate: ['indeterminate', 0],
    selected: ['selected', 0],
    open: ['open', 0],
    scrolltop: ['scrollTop', 1],
    scrollleft: ['scrollLeft', 1],
    value: ['value', 2],
  };
  const bp = (el) =>
    [...(el.attributes || [])].filter(
      (attr) => attr.name.startsWith('data-bind-prop:') && attr.value,
    );
  const wp = (el, suffix, val) => {
    const spec = pa[suffix] || pa[suffix.toLowerCase()];
    if (!spec) return;
    const prop = spec[0];
    if (el[prop] === undefined) return;
    // <progress>.value is not dirty/user-interactive; null=indeterminate (no attr),
    // so skip the string write (data-bind:value owns progress). Mirrors wa().
    if (spec[1] === 2 && el.localName == 'progress') return;
    el[prop] = spec[1] === 0 ? val != null && val !== false : spec[1] === 1 ? Number(val) || 0 : fb(val);
  };
  const wpd = async (el, ref, suffix, state) => {
    if (ref.includes('#')) {
      const hi = ref.lastIndexOf('#');
      if (hi <= 0 || hi === ref.length - 1) return;
      const mod = await im(ref.slice(0, hi));
      wp(el, suffix, mod[ref.slice(hi + 1)]?.run?.(state));
    } else if (ref.startsWith('state.')) {
      wp(el, suffix, vp(state, ref.slice(6)));
    }
  };
  const as = async (host, state) => {
    const hb = host.getAttribute?.('data-bind');
    if (hb?.includes('#')) await wd(host, hb, undefined, state);
    else ws(host, hb, undefined, state);
    for (const el of qa(host, '[data-bind]')) {
      if (sh(el, host)) {
        const binding = el.getAttribute('data-bind');
        if (binding?.includes('#')) {
          await wd(el, binding, undefined, state);
        } else {
          ws(el, binding, undefined, state);
        }
      }
    }
    for (const el of [host, ...qa(host, '*')]) {
      if (!sh(el, host)) continue;
      for (const attr of ba(el)) {
        if (attr.value.includes('#')) {
          await wd(
            el,
            attr.value,
            attr.name.slice('data-bind:'.length),
            state,
          );
          continue;
        }
        ws(
          el,
          attr.value,
          attr.name.slice('data-bind:'.length),
          state,
        );
      }
      // SPEC.md §4.8 data-bind-prop: live property write after the attribute pass.
      for (const attr of bp(el)) {
        await wpd(el, attr.value, attr.name.slice('data-bind-prop:'.length), state);
      }
    }
  };
  const rd = (val) =>
    (val ?? '')
      .split(/[\s,]+/)
      .map((dep) => dep.trim())
      .filter(Boolean);
  ${fragmentTargetEscapeReadableSource}
  const sq = escapeCssString;
  const hsaf = (value) => value && !/[\x00-\x1f\x7f\s;,#=]/.test(value);
  const hsc = (value) => hsaf(value) && !value.includes(':');
  const targetIdentity = (el) =>
    el.getAttribute('kovo-fragment-target') ??
    el.getAttribute('id') ??
    el.getAttribute('kovo-c') ??
    '';
  const liveTargetIdentity = (el) =>
    el.getAttribute('kovo-live-component') ?? el.getAttribute('kovo-c') ?? targetIdentity(el);
  const liveProps = (el) => {
    try {
      const props = JSON.parse(el.getAttribute('kovo-props') || '{}');
      return props && typeof props === 'object' && !Array.isArray(props) ? props : {};
    } catch {
      return {};
    }
  };
  const rt = () => [
    ...new Set(
      [...doc.querySelectorAll('[kovo-deps]')]
        .map((el) => {
          const deps = rd(el.getAttribute('kovo-deps'));
          const target = targetIdentity(el);
          if (!hsaf(target) || !deps.every(hsaf)) return '';
          return target && (deps.length ? target + '=' + deps.join(' ') : target);
        })
        .filter(Boolean)
    )
  ];
  const rlt = () => {
    const seen = new Set();
    const targets = [];
    for (const el of doc.querySelectorAll('[kovo-deps]')) {
      const target = targetIdentity(el);
      const component = liveTargetIdentity(el);
      const token = el.getAttribute('kovo-live-token');
      if (!hsaf(target) || !hsc(component) || !hsaf(token)) continue;
      if (!target || seen.has(target)) continue;
      seen.add(target);
      targets.push(target + '#' + component + '@' + token + ':' + JSON.stringify(liveProps(el)));
    }
    return targets;
  };
  // SPEC.md §9.1: inline fragment apply uses the same escaped target lookup
  // precedence as the modular runtime and Kovo-Targets collection.
  const ftd = (root, target) => {
    try {
      const selectorTarget = sq(target);
      return (
        root.querySelector?.('[kovo-fragment-target="' + selectorTarget + '"]') ??
        root.getElementById?.(target) ??
        root.querySelector?.('[id="' + selectorTarget + '"]') ??
        root.querySelector?.('[kovo-c="' + selectorTarget + '"]') ??
        root.querySelector?.('kovo-defer[target="' + selectorTarget + '"]')
      );
    } catch {
      return;
    }
  };
  const ft = (target) => ftd(doc, target);
  const hs = (el) => ((el = el.closest('[kovo-c]') || el).a ||= new AbortController()).signal;
  const kb = (root = doc) =>
    root.querySelector?.('meta[name="kovo-build"]')?.getAttribute('content') || '';
  const bh = (res) => bns.readHeader(res, 'Kovo-Build') ?? '';
  const qwk = (name, key) => {
    if (!name) return '';
    return key == null || key === '' ? name : key.startsWith(name + ':') ? key : name + ':' + key;
  };
  const qurl = (wireKey) => {
    const i = wireKey.indexOf(':');
    const n = i > 0 ? wireKey.slice(0, i) : wireKey;
    const k = i > 0 ? wireKey.slice(i + 1) : undefined;
    return n ? '/_q/' + encodeURIComponent(n) + (k == null ? '' : '?key=' + encodeURIComponent(k)) : '';
  };
  const rbd = (nextBody) => {
    if (doc.documentElement?.replaceChild && doc.body) {
      doc.documentElement.replaceChild(nextBody, doc.body);
    } else {
      doc.body.replaceWith(nextBody);
    }
    return nextBody;
  };
  const ks = 'script[data-kovo-csp-hash]';
  const rscr = (root) => {
    for (const old of qa(root, ks)) {
      if (!old.isConnected) continue;
      const fresh = doc.createElement('script');
      for (const attr of old.attributes) fresh.setAttribute(attr.name, attr.value);
      fresh.textContent = old.textContent;
      old.replaceWith(fresh);
    }
  };
  const hk = (el) => {
    if (el.nodeType !== 1) return '';
    if (el.tagName === 'STYLE') {
      const criticalHref = el.getAttribute('data-kovo-critical-href');
      return criticalHref ? ['style', criticalHref, el.textContent || ''].join('|') : '';
    }
    if (el.tagName === 'SCRIPT') return el.outerHTML ? 'script|' + el.outerHTML : '';
    if (el.tagName !== 'LINK') return '';
    let rel = (el.getAttribute('rel') || '')
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => token.toLowerCase())
      .sort()
      .join(' ');
    if (
      rel === 'preload' &&
      el.getAttribute('as') === 'style' &&
      el.hasAttribute('data-kovo-deferred-style')
    ) {
      rel = 'stylesheet';
    }
    if (rel !== 'stylesheet' && rel !== 'modulepreload') return '';
    const href = el.getAttribute('href');
    if (!href) return '';
    try {
      return [
        'link',
        rel,
        new URL(href, location.href).href,
        rel === 'modulepreload' ? el.getAttribute('as') || '' : '',
        el.getAttribute('media') || '',
        el.getAttribute('crossorigin') || '',
        el.getAttribute('integrity') || '',
        el.getAttribute('referrerpolicy') || '',
        el.getAttribute('type') || '',
      ].join('|');
    } catch {
      return '';
    }
  };
  const ch = (nextHead) => {
    const pool = new Map();
    for (const el of [...doc.head.childNodes]) {
      const key = hk(el);
      if (!key) continue;
      const list = pool.get(key) || [];
      list.push(el);
      pool.set(key, list);
    }

    const kept = new Set();
    const pending = [];
    const flush = (anchor) => {
      for (const next of pending.splice(0)) doc.head.insertBefore(next.cloneNode(true), anchor);
    };
    for (const el of [...doc.head.childNodes]) {
      if (!hk(el)) el.remove();
    }
    for (const next of [...nextHead.childNodes]) {
      const key = hk(next);
      if (!key) {
        pending.push(next);
        continue;
      }
      const match = pool.get(key)?.shift();
      const node = match || next.cloneNode(true);
      kept.add(node);
      // SPEC.md §4.4: enhanced navigation must not create a transient unstyled
      // document. Moving a connected stylesheet can briefly detach its rules in
      // Chromium, so matched head assets keep their physical DOM position.
      if (!match) doc.head.appendChild(node);
      flush(node);
    }
    for (const el of [...doc.head.childNodes]) {
      if (hk(el) && !kept.has(el)) el.remove();
    }
    flush(null);
  };
  ${enhancedNavigationReadableSource}
  const nav = installEnhancedNavigationRuntime({
    acceptHeader: ${JSON.stringify(enhancedNavigationDocumentAcceptHeader)},
    applyDocumentElementAttributes: xd,
    applyHead: ch,
    applyStylePromotion: () => ps(),
    document: doc,
    morph: m,
    onSessionTransition: () => retireBroadcast(),
    queryAll: qa,
    replayScripts: rscr,
    replaceBody: rbd,
    replaceElementAttributes: xa,
    runTriggers: () => tr(),
  });
  const an = nav.navigate;
  const inav = nav.handleClick;
  const sf = nav.saveScroll;
  const ng = (href) => {
    if (globalThis.history?.scrollRestoration !== undefined) {
      globalThis.history.scrollRestoration = 'auto';
    }
    bns.navigateSameOrigin(href);
  };
  for (const el of qa(
    doc,
    'input[type="checkbox"][aria-checked="mixed"],input[type="checkbox"][data-state="indeterminate"]',
  )) {
    if (el.indeterminate !== undefined) el.indeterminate = true;
  }
  ${wireParserReadableSource}
  ${responseApplyReadableSource}
  const dq = (type, init) => {
    dispatchEvent(new CustomEvent(type, init));
  };
  const ea = (value) =>
    String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  const fab = (body, build) => {
    const activeId = doc.activeElement?.id;
    ab(body, build);
    if (activeId && (!doc.activeElement || doc.activeElement === doc.body)) {
      doc.getElementById(activeId)?.focus?.({ preventScroll: true });
    }
  };
  ${documentLifecycleReadableSource}
  const dl = createDocumentLifecycleRecovery({
    acceptHeader: ${JSON.stringify(enhancedNavigationDocumentAcceptHeader)},
    applyBody: fab,
    buildHeader: bh,
    currentBuild: kb,
    document: doc,
    encodeAttribute: ea,
    findTarget: ftd,
    liveTargets: rlt,
    queryAll: qa,
    queryUrl: qurl,
    readAttribute,
    readElementAttribute: readWireElementAttribute,
    targetHeader: rt,
    wireKey: qwk,
  });
  const qd = dl.isDeltaQuery;
  const qr = dl.refreshQuery;
  const frf = dl.refreshLiveTargets;
  const rememberQueryChunk = dl.rememberQueryChunk;
  const rememberQueryScripts = dl.rememberQueryScripts;
  const aq = (queries, applyQueries) => {
    for (const q of queries) rememberQueryChunk(q);
    if (applyQueries) {
      const ok = [];
      for (const q of queries) qd(q) ? qr(q) : ok.push(q);
      dq('kovo:query', { detail: { queries: ok } });
    }
  };
  const af = (fragments) => {
    for (const x of fragments) {
      if (x.mode === 'append') continue;
      const e = ft(x.target);
      if (e) for (const y of qa(e, '[kovo-c]')) {
        const html = renderedFragmentHtmlContent(x.html);
        if (html.includes('kovo-c="' + y.getAttribute('kovo-c') + '"') && (!y.getAttribute('kovo-key') && !y.getAttribute('id') || html.includes('kovo-key="' + y.getAttribute('kovo-key') + '"') || html.includes('id="' + y.getAttribute('id') + '"'))) continue;
        y.a?.abort();
      }
    }
    applyInlineMutationResponseChunks({ fragments }, { findFragmentTarget: ft });
  };
  const ab = (body, build = kb()) => {
    const chunks = readInlineMutationResponseBodyChunks(body);
    const skew = kb() && (!build || build !== kb());
    if (skew) {
      for (const q of chunks.queries) qr(q);
      return;
    }
    aq(chunks.queries, 1);
    af(chunks.fragments);
    at(chunks.texts);
  };
  globalThis.__kovo_a = ab;
  const st = {};
  const se = {};
  const sft = (target) => {
    try {
      return doc.querySelector('[data-stream-text="' + sq(target) + '"]');
    } catch {
      return;
    }
  };
  const sr = async (el, source) => {
    const ref = el.getAttribute?.('data-stream-renderer');
    const hi = ref?.lastIndexOf('#') ?? -1;
    if (hi <= 0 || hi === ref.length - 1) return;
    const mod = await im(ref.slice(0, hi));
    const render = mod[ref.slice(hi + 1)];
    if (typeof render === 'function') await render(el, source, {});
  };
  const at = (texts) => {
    let missing = false;
    for (const x of texts || []) {
      const el = sft(x.target);
      if (!el) {
        missing = true;
        continue;
      }
      const text = unescapeHtml(x.text);
      const source = x.mode === 'checkpoint' ? text : (st[x.target] ?? el.textContent ?? '') + text;
      st[x.target] = source;
      se[x.target] = el;
      el.textContent = source;
      el.setAttribute?.('data-stream-state', 'streaming');
      void sr(el, source).catch(() => {});
    }
    return !missing;
  };
  const sfail = () => {
    for (const key in se) se[key].setAttribute?.('data-stream-state', 'error');
  };
  const ax = (chunks) => {
    const textStart = chunks.texts[0]?.start ?? 1 / 0;
    af(readFragmentChunksFromElements(chunks.fragments.filter((chunk) => chunk.start < textStart)));
    const appliedTexts = at(readStreamTextChunksFromElements(chunks.texts));
    af(readFragmentChunksFromElements(chunks.fragments.filter((chunk) => chunk.start >= textStart)));
    return appliedTexts;
  };
  const streamRecoveryError = {};
  const recoverStream = async (source) => {
    try {
      // Cancellation is best effort and must not let a hostile/stuck underlying source delay the
      // security recovery. Attach a rejection sink, then hard-reload immediately.
      source?.cancel?.()?.catch?.(() => {});
    } catch {}
    await location.reload?.();
  };
  const cp = (body, state) => {
    if (state.done) {
      if (body.trim()) throw Error('Streaming mutation emitted bytes after <kovo-done>');
      return '';
    }
    const chunks = readMutationResponseElementChunks(body);
    const dones = readElementChunks(body, 'kovo-done');
    let end = 0;
    for (const group of [chunks.queries, chunks.fragments, chunks.texts, dones]) {
      for (const x of group) if (x.end > end) end = x.end;
    }
    if (!end) return body;
    state.queries.push(...chunks.queries);
    if (!dones.length) {
      if (!ax(chunks)) {
        sfail();
        throw Error('Missing kovo-text target');
      }
      return body.slice(end);
    }
    const firstDone = dones.reduce((first, current) => current.start < first.start ? current : first);
    const hasPostDoneChunk = [chunks.queries, chunks.fragments, chunks.texts]
      .some((group) => group.some((chunk) => chunk.start > firstDone.start));
    const reason = dones
      .map((x) => readAttribute(x.attrs, 'reason') ?? 'complete')
      .find((value) => value !== 'complete') ?? (hasPostDoneChunk ? 'invalid' : 'complete');
    if (!ax(chunks)) {
      sfail();
      throw Error('Missing kovo-text target');
    }
    state.done = true;
    if (reason === 'complete') {
      aq(state.queries, true);
      state.queries.length = 0;
      return body.slice(end);
    }
    aq(state.queries, false);
    state.queries.length = 0;
    sfail();
    throw Error('Streaming mutation was not confirmed: ' + reason);
  };
  const asr = async (body) => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const state = { done: false, queries: [] };
    let pending = '';
    try {
      while (true) {
        const read = await reader.read();
        if (read.done) break;
        pending = cp(pending + decoder.decode(read.value, { stream: true }), state);
      }
      pending += decoder.decode();
      if (pending.trim()) {
        sfail();
        throw Error('Streaming mutation ended with an incomplete wire element');
      }
      if (!state.done) throw Error('Streaming mutation ended without <kovo-done>');
    } catch (error) {
      sfail();
      // bugz-26 M3 / SPEC §9.1: partial fragments are not authority. Cancel the reader and
      // initiate framework-owned hard recovery before the promise rejects; the private sentinel
      // prevents the generic form fallback from racing a second navigation.
      await recoverStream(reader);
      throw streamRecoveryError;
    } finally {
      reader.releaseLock?.();
    }
  };
  const fsb = (form) => {
    if (typeof form.submit === 'function') {
      form.submit();
      return;
    }
    form.setAttribute?.('data-error-code', 'NETWORK_ERROR');
    form.setAttribute?.('kovo-error', '');
  };
  const chg = (response) => {
    const value = bns.readHeader(response, 'Kovo-Changes');
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(schg) : [];
    } catch {
      return [];
    }
  };
  const schg = (value) =>
    value &&
    typeof value === 'object' &&
    typeof value.domain === 'string' &&
    (value.keys === undefined || Array.isArray(value.keys) && value.keys.every((key) => typeof key === 'string'));
  const sfp = doc.querySelector?.('meta[name="kovo-session"]')?.getAttribute('content') ?? undefined;
  let bc;
  try {
    bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel('kovo:mutation-response') : undefined;
  } catch {}
  const bmsg = (value) =>
    value &&
    typeof value === 'object' &&
    value.type === 'kovo:mutation-response' &&
    typeof value.body === 'string' &&
    (value.buildToken === undefined || typeof value.buildToken === 'string') &&
    Array.isArray(value.changes) &&
    value.changes.every(schg);
  if (bc) {
    bc.onmessage = (event) => {
      const data = event.data;
      if (!bmsg(data) || data.principal !== sfp) return;
      ab(data.body, data.buildToken);
    };
  }
  const pb = (body, changes) => {
    if (!bc) return;
    bc.postMessage({
      body,
      ...(kb() ? { buildToken: kb() } : {}),
      changes,
      ...(sfp === undefined ? {} : { principal: sfp }),
      type: 'kovo:mutation-response',
    });
  };
  const rsp = (response, fallback = 0) => {
    const value = bns.readResponseField(response, 'status');
    return typeof value === 'number' && value >= 0 && value <= 999 ? value : fallback;
  };
  const rst = (response) =>
    bns.isTrimmedAsciiEqual(bns.readHeader(response, 'Kovo-Session-Transition'), 'reload');
  function retireBroadcast() {
    if (bc) {
      bc.onmessage = null;
      bc.close?.();
      bc = undefined;
    }
  }
  const retireSession = () => {
    retireBroadcast();
    bns.reload();
  };
  const ant = (form, body) => {
    const next = bns.safeSameOriginPath(bns.readFormDataValue(body, 'next'));
    if (next) return next;
    const current = bns.currentUrl();
    const action = current ? bns.parseUrl(form.action || '', current.href) : undefined;
    if (action?.pathname === '/_m/auth/sign-in' || action?.pathname === '/auth/sign-in') return '/';
    return bns.currentPathTarget() || '/';
  };
  const eaf = (response, changes, text) => {
    const status = rsp(response, 200);
    if (status < 200 || status >= 300 || bns.readResponseField(response, 'ok') === false ||
      !bns.isTrimmedAsciiEqual(text, '')) return false;
    for (let index = 0; index < changes.length; index += 1) {
      if (changes[index]?.domain === 'auth') return true;
    }
    return false;
  };
  const sef = (event, form) => {
    event.preventDefault();
    const streaming = form.getAttribute?.('data-mutation-stream') !== null;
    const body = new FormData(form, event.submitter);
    const formIdem = bns.readFormDataValue(body, 'Kovo-Idem');
    const idem = typeof formIdem === 'string' && formIdem !== '' ? formIdem : ci();
    bns.fetchValue(form.action, {
      body,
      headers: {
        Accept: streaming
          ? 'text/vnd.kovo.fragment+html; stream=1'
          : 'text/vnd.kovo.fragment+html',
        'Kovo-Form-Target': targetIdentity(form),
        'Kovo-Fragment': 'true',
        'Kovo-Idem': String(idem),
        'Kovo-Live-Targets': rlt().join('; '),
        ...(streaming ? { 'Kovo-Stream': 'true' } : {}),
        'Kovo-Targets': rt().join('; '),
      },
      keepalive: !streaming,
      method: bns.upper(form.method || 'post'),
    })
      .then((response) => {
        const status = rsp(response);
        // SPEC §9.3: retirement wins over every redirect/body channel; a response carrying
        // conflicting metadata cannot keep the old page-load principal alive.
        if (rst(response)) {
          retireSession();
          return;
        }
        const reauth = bns.readHeader(response, 'Kovo-Reauth');
        if (status === 401 && reauth) {
          ng(bns.safeSameOriginPath(reauth) || '/');
          return;
        }
        const redirected = bns.readResponseField(response, 'redirected') === true;
        const responseUrl = bns.readResponseField(response, 'url');
        const redirect = status >= 300 && status < 400
          ? bns.readHeader(response, 'Location')
          : redirected && typeof responseUrl === 'string'
            ? responseUrl
            : '';
        if (redirect) {
          ng(redirect);
          return;
        }
        const responseBody = bns.readResponseField(response, 'body');
        if (streaming && responseBody) {
          // bugz-26 H6 / SPEC §14: validate the response build before acquiring a reader. A
          // missing/mismatched token must cancel unread bytes and hard-reload with zero apply.
          const responseBuild = bh(response);
          if (kb() && (!responseBuild || responseBuild !== kb())) {
            return recoverStream(responseBody);
          }
          return asr(responseBody);
        }
        return bns.readResponseText(response).then((text) => {
          const changes = chg(response);
          if (eaf(response, changes, text)) {
            ng(ant(form, body));
            return;
          }
          ab(text, bh(response));
          const completedStatus = rsp(response, 200);
          if (completedStatus >= 200 && completedStatus < 300 && bns.readResponseField(response, 'ok') !== false) {
            pb(text, changes);
          }
        });
      })
      .catch((error) => {
        if (error !== streamRecoveryError) fsb(form);
      });
  };
  const rp = (el) =>
    (el.getAttribute('kovo-param-types') || '').split(/[\s,]+/).reduce((types, entry) => {
      const [name, type] = entry.split(':');
      if (name) types[name] = type;
      return types;
    }, {},);
  const dispatch = async (event) => {
    if (event.type === 'submit') {
      const form = event.target?.closest?.('form[enhance],form[data-enhance],form[data-mutation]',);
      if (form) {
        sef(event, form);
        return;
      }
    }
    if (event.type === 'click' && inav(event)) return;
    const el = event.target?.closest?.('[on\\:' + event.type + ']');
    const refs = el?.getAttribute('on:' + event.type);
    if (!el || !refs) return;
    // SPEC.md §4.4: cancel the native context menu synchronously, in this
    // capture-phase prefix, before the awaited handler import below. An
    // on:contextmenu element opts into a custom menu, and deferring
    // preventDefault until after the await-import misses the dispatch window and
    // leaks the browser menu (the handler's own preventDefault runs too late).
    // The marker lets the chained primitive (SPEC.md §4.6 contextMenu open) tell
    // this framework native-suppression apart from a genuine author preventDefault
    // so it still opens the styled menu rather than treating itself as superseded.
    if (event.type === 'contextmenu' && event.cancelable && !event.defaultPrevented) {
      event.preventDefault();
      event.kovoNativeDefaultManaged = true;
    }
    const params = {};
    const pt = rp(el);
    const state = rs(el);
    const st = rh(el);
    const context = { params, state, signal: hs(el) };
    for (const attr of el.attributes || []) {
      if (!attr.name.startsWith('data-p-')) continue;
      const name = attr.name
        .slice('data-p-'.length)
        .replace(/-([a-z0-9])/g, (_match, char) => char.toUpperCase());
      const type = pt[name];
      const val = attr.value;
      params[name] = type === 'number' ? Number(val) : type === 'boolean' ? val === 'true' : val;
    }
    const pc = [];
    for (const ref of refs.split(/\s+/).filter(Boolean)) {
      const hi = ref.lastIndexOf('#');
      if (hi <= 0 || hi === ref.length - 1) throw Error('Invalid handler reference: ' + ref);
      const mod = await im(ref.slice(0, hi));
      const fn = mod[ref.slice(hi + 1)];
      if (typeof fn !== 'function') throw Error('Handler export not found: ' + ref);
      const prev = globalThis.__kovo_postCommitSchedule;
      globalThis.__kovo_postCommitSchedule = (cb) => pc.push(cb);
      let run;
      try {
        run = fn(event, context);
      } finally {
        globalThis.__kovo_postCommitSchedule = prev;
      }
      await run;
    }
    st?.setAttribute?.('kovo-state', JSON.stringify(state));
    if (st) await as(st, state);
    for (const cb of pc) try { cb(); } catch {}
  };
  const trigger = (type, target) => {
    void dispatch({ target, type });
  };
  const to = (el, type) => {
    const key = '__kovo_' + type;
    if (el[key]) return false;
    el[key] = 1;
    return true;
  };
  const tr = (root = doc) => {
    const matches = (selector) =>
      root.matches?.(selector) ? [root].concat(qa(root, selector)) : qa(root, selector);
    matches('[on\\:load]').forEach((el) => to(el, 'load') && trigger('load', el));
    matches('[on\\:idle]').forEach((el) =>
      to(el, 'idle') && (globalThis.requestIdleCallback || setTimeout)(() => trigger('idle', el)),
    );
    if (globalThis.IntersectionObserver) {
      const observer = new IntersectionObserver((entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          trigger('visible', entry.target);
        }),
      );
      matches('[on\\:visible]').forEach((el) => to(el, 'visible') && observer.observe(el));
    }
  };
  const ps = () => {
    const promote = () => {
      for (const el of qa(doc, 'link[data-kovo-deferred-style]')) {
        const href = el.getAttribute?.('href');
        if (!href) continue;
        const existing = qa(doc, 'link[rel="stylesheet"][href]').some(
          (link) => link !== el && !link.closest?.('noscript') && link.getAttribute?.('href') === href,
        );
        if (existing) {
          el.remove?.();
          continue;
        }
        el.rel = 'stylesheet';
        el.removeAttribute?.('data-kovo-deferred-style');
      }
    };
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === 'function') raf(() => raf(promote));
    else setTimeout(promote);
  };
  for (const event of events) addEventListener(event, dispatch, { capture: true });
  // SPEC.md §4.4: synthesize delegated pointerenter/pointerleave from the bubbling
  // pointerover/pointerout pair, firing only when the pointer crosses the on:* element's
  // boundary (relatedTarget outside it) so child movement does not re-fire enter/leave.
  const crossing = (overType, enterType) =>
    addEventListener(
      overType,
      (event) => {
        const el = event.target?.closest?.('[on\\:' + enterType + ']');
        if (!el || el.contains?.(event.relatedTarget)) return;
        void dispatch({ relatedTarget: event.relatedTarget, target: el, type: enterType });
      },
      { capture: true },
    );
  crossing('pointerover', 'pointerenter');
  crossing('pointerout', 'pointerleave');
  dl.install(nav);
  // SPEC.md §4.7: declared triggers are legible in body markup, while the default
  // document emits the loader in <head>. Defer the scan one task so the parser can
  // continue into the body; event delegation above is installed immediately.
  ps();
  setTimeout(tr);
}
`;
}

export function buildInlineKovoLoaderStubInstallerReadableSource(): string {
  return String.raw`
/* SPEC.md §4.4: tiny paint-first bootstrap; imports the full runtime after paint or interaction. */
function installInlineKovoBootstrap(runtimeUrl, runtimeImport) {
  const doc = document;
  const events = ['click', 'submit'];
  const queued = [];
  const streamQueue = [];
  let loading;
  const previousApply = globalThis.__kovo_a;
  globalThis.__kovo_a = (body) => {
    streamQueue.push(body);
  };
  const qa = (root, selector) =>
    root.querySelectorAll ? [...root.querySelectorAll(selector)] : [];
  const ps = () => {
    const promote = () => {
      for (const el of qa(doc, 'link[data-kovo-deferred-style]')) {
        const href = el.getAttribute?.('href');
        if (!href) continue;
        const existing = qa(doc, 'link[rel="stylesheet"][href]').some(
          (link) => link !== el && !link.closest?.('noscript') && link.getAttribute?.('href') === href,
        );
        if (existing) {
          el.remove?.();
          continue;
        }
        el.rel = 'stylesheet';
        el.removeAttribute?.('data-kovo-deferred-style');
      }
    };
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === 'function') raf(() => raf(promote));
    else setTimeout(promote);
  };
  const enhancedAnchor = (event) => {
    if (
      event.defaultPrevented ||
      event.button ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const target = event.target;
    const anchor = target?.closest?.('a[href]');
    if (
      !anchor ||
      target?.closest?.('[on\\:click]') ||
      anchor.target ||
      anchor.hasAttribute?.('download')
    ) {
      return;
    }
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
    return { href: url.href, target, type: 'click' };
  };
  const enhancedSubmit = (event) => {
    const form = event.target?.closest?.('form[enhance],form[data-enhance],form[data-mutation]');
    return form ? { submitter: event.submitter, target: form, type: 'submit' } : undefined;
  };
  const authoredClick = (event) => {
    if (
      event.defaultPrevented ||
      event.button ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const target = event.target;
    return target?.closest?.('[on\\:click]') ? { target, type: 'click' } : undefined;
  };
  const replay = (item) => {
    if (!item.target?.isConnected) return;
    if (item.type === 'submit') {
      let event;
      try {
        event = new SubmitEvent('submit', {
          bubbles: true,
          cancelable: true,
          submitter: item.submitter,
        });
      } catch {
        event = new Event('submit', { bubbles: true, cancelable: true });
      }
      item.target.dispatchEvent(event);
      return;
    }
    item.target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  };
  const fallback = (item) => {
    if (!item.target?.isConnected) return;
    if (item.type === 'submit') {
      if (typeof item.target.submit === 'function') item.target.submit();
      else replay(item);
      return;
    }
    if (item.href) location.assign?.(item.href);
    else replay(item);
  };
  const cleanup = () => {
    for (const event of events) removeEventListener(event, capture, { capture: true });
  };
  const load = () =>
    (loading ||= runtimeImport(runtimeUrl)
      .then((mod) => {
        cleanup();
        mod.installKovoDeferredRuntime?.();
        const apply = globalThis.__kovo_a;
        if (typeof apply === 'function' && apply !== previousApply) {
          for (const body of streamQueue.splice(0)) apply(body);
        }
        for (const item of queued.splice(0)) replay(item);
      })
      .catch(() => {
        cleanup();
        for (const item of queued.splice(0)) fallback(item);
      }));
  const capture = (event) => {
    const item =
      event.type === 'submit' ? enhancedSubmit(event) : authoredClick(event) || enhancedAnchor(event);
    if (!item) return;
    event.preventDefault();
    queued.push(item);
    void load();
  };
  for (const event of events) addEventListener(event, capture, { capture: true });
  ps();
  const raf = globalThis.requestAnimationFrame;
  if (typeof raf === 'function') raf(() => raf(() => void load()));
  else setTimeout(() => void load());
}
`;
}

export function buildInlineKovoLoaderInstallerSource(
  source = inlineKovoLoaderInstallerReadableSource,
): string {
  assertDefaultInlineKovoLoaderInstallerHelperParity(source);
  const installerInput =
    source === inlineKovoLoaderInstallerReadableSource
      ? compactInlineKovoLoaderInstallerLocalNames(source)
      : source;
  const installerSource = minifyInlineJavaScriptSource(installerInput);
  assertDefaultMinifiedInlineKovoLoaderInstallerHelperParity(source, installerSource);
  return installerSource;
}

export function buildInlineKovoLoaderStubInstallerSource(
  source = inlineKovoLoaderStubInstallerReadableSource,
): string {
  return minifyInlineJavaScriptSource(source);
}

export interface EmitInlineKovoLoaderModuleOptions {
  check?: boolean;
  source?: string;
  targetPath?: string;
}

export interface EmitInlineKovoLoaderModuleResult {
  changed: boolean;
  source: string;
  targetPath: string;
}

export function buildInlineKovoLoaderModuleSource(
  source = inlineKovoLoaderInstallerReadableSource,
): string {
  const installerSource = buildInlineKovoLoaderInstallerSource(source);
  const stubInstallerSource = buildInlineKovoLoaderStubInstallerSource();
  const runtimeModuleSource = buildKovoDeferredRuntimeModuleSource(installerSource);
  const runtimeModuleVersion = createHash('sha256')
    .update(runtimeModuleSource)
    .digest('hex')
    .slice(0, 12);
  assertInlineKovoLoaderBootstrapGzipBudget(
    stubInstallerSource,
    'Generated inline Kovo loader bootstrap',
  );

  const moduleSource = `${buildInlineKovoLoaderModuleLines({
    installerSource,
    runtimeModuleSource,
    runtimeModuleVersion,
    stubInstallerSource,
  }).join('\n')}\n`;
  assertInlineKovoLoaderModuleArtifactParity(moduleSource, 'Generated inline Kovo loader module');

  return moduleSource;
}

interface InlineKovoLoaderModuleLineParts {
  installerSource: string;
  runtimeModuleSource: string;
  runtimeModuleVersion: string;
  stubInstallerSource: string;
}

function buildInlineKovoLoaderModuleLines({
  installerSource,
  runtimeModuleSource,
  runtimeModuleVersion,
  stubInstallerSource,
}: InlineKovoLoaderModuleLineParts): string[] {
  const moduleHeaderLines = [
    '// @ts-nocheck',
    '// Generated from the SPEC.md §4.4 readable inline bootstrap by inline-loader-build.ts.',
    "import type { ImportHandlerModule } from './handlers.js';",
    '',
  ];
  const runtimeSeedLines = [
    '// SPEC.md §4.4 caps the always-loaded document bootstrap, not this deferred',
    '// runtime installer source. This literal seeds the versioned runtime module.',
    '/** Runtime API used by Kovo applications and generated runtime integration. */',
    `export const inlineKovoLoaderInstallerSource = ${inlineJavaScriptTemplateLiteral(
      installerSource,
    )};`,
    '/** @internal Bootstrap source used by document shells before the deferred runtime module loads. */',
    `export const inlineKovoLoaderBootstrapInstallerSource = ${inlineJavaScriptTemplateLiteral(
      stubInstallerSource,
    )};`,
    '/** @internal Deferred runtime module path emitted by server document rendering. */',
    "export const kovoDeferredRuntimeModulePath = '/c/kovo-runtime.client.js';",
    '/** @internal Content version for the deferred runtime module emitted by server document rendering. */',
    `export const kovoDeferredRuntimeModuleVersion = '${runtimeModuleVersion}';`,
    '/** @internal Deferred runtime module source emitted by server document rendering. */',
    `export const kovoDeferredRuntimeModuleSource = ${inlineJavaScriptTemplateLiteral(
      runtimeModuleSource,
    )};`,
    '',
  ];
  const runtimeInstallerLines = [
    '// prettier-ignore',
    'const inlineKovoLoaderInstaller = (',
    `  ${installerSource}`,
    ') as (',
    '    importModule: ImportHandlerModule,',
    '  ) => void;',
    '',
    '/** Runtime API used by Kovo applications and generated runtime integration. */',
    'export function installInlineKovoLoader(importModule: ImportHandlerModule): void {',
    '  inlineKovoLoaderInstaller(importModule);',
    '}',
    '',
  ];
  const bootstrapInstallerLines = [
    '// prettier-ignore',
    'const inlineKovoLoaderBootstrapInstaller = (',
    `  ${stubInstallerSource}`,
    ') as (',
    '    runtimeUrl: string,',
    '    runtimeImport: (url: string) => Promise<{ installKovoDeferredRuntime?: () => void }>,',
    '  ) => void;',
    '',
    '/** Runtime API used by Kovo applications and generated runtime integration. */',
    'export function installInlineKovoBootstrap(',
    '  runtimeUrl: string,',
    '  runtimeImport?: (url: string) => Promise<{ installKovoDeferredRuntime?: () => void }>,',
    '): void {',
    '  inlineKovoLoaderBootstrapInstaller(',
    '    runtimeUrl,',
    '    runtimeImport ?? ((url) => import(/* @vite-ignore */ url)),',
    '  );',
    '}',
    '',
  ];
  const publicSourceFactoryLines = [
    '/** Runtime API used by Kovo applications and generated runtime integration. */',
    'export function createInlineKovoLoaderSource(',
    '  runtimeModuleExpression = JSON.stringify(kovoDeferredRuntimeModulePath),',
    '  runtimeImportExpression?: string,',
    '): string {',
    '  const importExpression = (',
    '    runtimeImportExpression ??',
    '    (runtimeModuleExpression === JSON.stringify(kovoDeferredRuntimeModulePath)',
    "      ? '(url)=>import(url)'",
    '      : runtimeModuleExpression)',
    '  ).trim();',
    '  const runtimeExpression = (',
    '    runtimeImportExpression === undefined',
    '      ? JSON.stringify(kovoDeferredRuntimeModulePath)',
    '      : runtimeModuleExpression',
    '  ).trim();',
    '  if (!runtimeExpression) {',
    "    throw new Error('Inline Kovo loader runtime expression cannot be empty.');",
    '  }',
    '  if (!importExpression) {',
    "    throw new Error('Inline Kovo loader runtime import expression cannot be empty.');",
    '  }',
    '',
    '  return `(${inlineKovoLoaderBootstrapInstallerSource})(${runtimeExpression},${importExpression});`;',
    '}',
    '',
    '/** Runtime API used by Kovo applications and generated runtime integration. */',
    'export const kovoLoaderSource = createInlineKovoLoaderSource();',
  ];

  return [
    ...moduleHeaderLines,
    ...runtimeSeedLines,
    ...runtimeInstallerLines,
    ...bootstrapInstallerLines,
    ...publicSourceFactoryLines,
  ];
}

function buildKovoDeferredRuntimeModuleSource(installerSource: string): string {
  return [
    `const install=(${installerSource});`,
    'export function installKovoDeferredRuntime(importModule=(url)=>import(url)){install(importModule);}',
    '',
  ].join('\n');
}

export function assertInlineKovoLoaderBootstrapGzipBudget(
  installerSource: string,
  label = 'Inline Kovo loader bootstrap',
): void {
  const bytes = gzipSync(createInlineKovoLoaderBootstrapSource(installerSource)).byteLength;
  if (bytes <= inlineKovoLoaderGzipByteBudget) return;

  throw new Error(
    `${label} exceeds SPEC.md §4.4 gzip budget: ${bytes} bytes > ${inlineKovoLoaderGzipByteBudget} bytes.`,
  );
}

function readInlineWireParserReadableSource(): string {
  return readInlineHelperReadableSource(inlineHelperSpecs.wireParser);
}

function readInlineResponseApplyReadableSource(): string {
  return readInlineHelperReadableSource(inlineHelperSpecs.responseApply);
}

function readInlineFragmentTargetEscapeReadableSource(): string {
  return readInlineHelperReadableSource(inlineHelperSpecs.fragmentTargetEscape);
}

function readInlineEnhancedNavigationReadableSource(): string {
  return readInlineHelperReadableSource(inlineHelperSpecs.enhancedNavigation);
}

function readInlineDocumentLifecycleReadableSource(): string {
  return readInlineHelperReadableSource(inlineHelperSpecs.documentLifecycle);
}

function readModularDefaultDelegatedEvents(
  source = readFileSync(modularLoaderSourcePath, 'utf8'),
): string[] {
  const sourceFile = ts.createSourceFile(
    'loader.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.name.text !== 'defaultDelegatedEvents'
      ) {
        continue;
      }
      const initializer =
        declaration.initializer && ts.isAsExpression(declaration.initializer)
          ? declaration.initializer.expression
          : declaration.initializer;
      if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
        throw new Error(
          'defaultDelegatedEvents must stay a literal string array for inline loader generation.',
        );
      }
      return initializer.elements.map((element) => {
        if (!ts.isStringLiteral(element)) {
          throw new Error(
            'defaultDelegatedEvents must contain only string literals for inline loader generation.',
          );
        }
        return element.text;
      });
    }
  }

  throw new Error('Inline Kovo loader could not find defaultDelegatedEvents in loader.ts.');
}

export function extractInlineWireParserReadableSource(
  source: string,
  rootFunctionNames: readonly string[] = inlineHelperSpecs.wireParser.rootFunctionNames,
): string {
  return extractInlineHelperReadableSourceForSpec(inlineHelperSpecs.wireParser, source, {
    rootFunctionNames,
  });
}

export function extractInlineResponseApplyReadableSource(
  source: string,
  rootFunctionNames: readonly string[] = inlineHelperSpecs.responseApply.rootFunctionNames,
): string {
  return extractInlineHelperReadableSourceForSpec(inlineHelperSpecs.responseApply, source, {
    rootFunctionNames,
  });
}

interface ExtractInlineHelperReadableSourceOptions {
  label: string;
  rootFunctionNames: readonly string[];
  source: string;
  sourceFileName: string;
}

function readInlineHelperReadableSource(spec: InlineHelperSpec): string {
  return extractInlineHelperReadableSourceForSpec(spec, readInlineHelperCanonicalSource(spec));
}

function readInlineHelperCanonicalSource(spec: InlineHelperSpec): string {
  return spec.sourcePaths.map((sourcePath) => readFileSync(sourcePath, 'utf8')).join('\n');
}

function extractInlineHelperReadableSourceForSpec(
  spec: InlineHelperSpec,
  source: string,
  options: { rootFunctionNames?: readonly string[] } = {},
): string {
  return extractInlineHelperReadableSource({
    label: spec.label,
    rootFunctionNames: options.rootFunctionNames ?? spec.rootFunctionNames,
    source,
    sourceFileName: spec.sourceFileName,
  });
}

function extractInlineHelperReadableSource({
  label,
  rootFunctionNames,
  source,
  sourceFileName,
}: ExtractInlineHelperReadableSourceOptions): string {
  const sourceFile = ts.createSourceFile(
    sourceFileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = new Map<string, ts.FunctionDeclaration>();
  const unsupportedTopLevelBindings = collectUnsupportedInlineHelperTopLevelBindings(sourceFile);

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      declarations.set(statement.name.text, statement);
    }
  }

  const missing = rootFunctionNames.filter((name) => !declarations.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Inline Kovo loader ${label} source is missing helper(s): ${missing.join(', ')}`,
    );
  }

  const included = collectInlineHelperDependencyClosure(
    label,
    sourceFile,
    declarations,
    unsupportedTopLevelBindings,
    rootFunctionNames,
  );
  const helperSource = [...included]
    .map((name) => declarations.get(name))
    .filter((declaration): declaration is ts.FunctionDeclaration => declaration !== undefined)
    .map((declaration) => declaration.getText(sourceFile).replace(/^export\s+function/, 'function'))
    .join('\n\n');
  const transpiled = ts.transpileModule(helperSource, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ESNext,
    },
  }).outputText;

  return transpiled.replace(/^"use strict";\s*/, '').trim();
}

export function assertInlineKovoLoaderInstallerWireParserParity(
  installerSource: string,
  wireParserSource: string = readInlineHelperCanonicalSource(inlineHelperSpecs.wireParser),
): void {
  assertInlineKovoLoaderInstallerHelperParity(
    inlineHelperSpecs.wireParser,
    installerSource,
    wireParserSource,
  );
}

export function assertMinifiedInlineKovoLoaderInstallerWireParserParity(
  installerSource: string,
  wireParserSource: string = readInlineHelperCanonicalSource(inlineHelperSpecs.wireParser),
): void {
  assertMinifiedInlineKovoLoaderInstallerHelperParity(
    inlineHelperSpecs.wireParser,
    installerSource,
    wireParserSource,
  );
}

export function assertInlineKovoLoaderInstallerResponseApplyParity(
  installerSource: string,
  responseApplySource: string = readInlineHelperCanonicalSource(inlineHelperSpecs.responseApply),
): void {
  assertInlineKovoLoaderInstallerHelperParity(
    inlineHelperSpecs.responseApply,
    installerSource,
    responseApplySource,
  );
}

export function assertMinifiedInlineKovoLoaderInstallerResponseApplyParity(
  installerSource: string,
  responseApplySource: string = readInlineHelperCanonicalSource(inlineHelperSpecs.responseApply),
): void {
  assertMinifiedInlineKovoLoaderInstallerHelperParity(
    inlineHelperSpecs.responseApply,
    installerSource,
    responseApplySource,
  );
}

export function assertInlineKovoLoaderTrustedTypesRouting(
  readableInstallerSource = inlineKovoLoaderInstallerReadableSource,
  minifiedInstallerSource = buildInlineKovoLoaderInstallerSource(readableInstallerSource),
  responseApplySource: string = readInlineHelperCanonicalSource(inlineHelperSpecs.responseApply),
): void {
  const readableApplySource = extractInlineHelperReadableSourceForSpec(
    inlineHelperSpecs.responseApply,
    responseApplySource,
  );

  assertInlineKovoLoaderTrustedTypesRoutingForSource({
    applySource: readableApplySource,
    installerSource: readableInstallerSource,
    mode: 'readable',
  });
  assertInlineKovoLoaderTrustedTypesRoutingForSource({
    applySource: minifyInlineJavaScriptSource(
      compactInlineKovoLoaderInstallerLocalNames(readableApplySource),
    ),
    installerSource: minifiedInstallerSource,
    mode: 'minified',
  });
}

type InlineKovoLoaderTrustedTypesRoutingMode = 'readable' | 'minified';

interface InlineKovoLoaderTrustedTypesRoutingAssertion {
  applySource: string;
  installerSource: string;
  mode: InlineKovoLoaderTrustedTypesRoutingMode;
}

function assertInlineKovoLoaderTrustedTypesRoutingForSource({
  applySource,
  installerSource,
  mode,
}: InlineKovoLoaderTrustedTypesRoutingAssertion): void {
  const sinkRoutes =
    mode === 'readable'
      ? countSubstring(applySource, 'innerHTML = trustedHtml(')
      : countSubstring(installerSource, 'innerHTML=th(') +
        countSubstring(installerSource, 'innerHTML=trustedHtml(');
  if (sinkRoutes !== 2) {
    throw new Error(
      `Inline Kovo loader Trusted Types routing must wrap both ${mode} response-apply innerHTML sinks; found ${sinkRoutes}.`,
    );
  }

  const requiredTokens =
    mode === 'readable'
      ? [
          ['function trustedHtml(h)'],
          ['const t = w.trustedTypes;'],
          ["p = t.createPolicy('kovo', { createHTML: (s) => s });"],
          ['return p ? p.createHTML(h) : h;'],
        ]
      : [
          ['function th(h)', 'function trustedHtml(h)'],
          ['trustedTypes'],
          ["createPolicy('kovo'"],
          ['createHTML'],
          ['p.createHTML(h)'],
        ];
  for (const tokens of requiredTokens) {
    if (
      !tokens.some((token) => applySource.includes(token)) ||
      (mode === 'minified' && !tokens.some((token) => installerSource.includes(token)))
    ) {
      throw new Error(
        `Inline Kovo loader ${mode} Trusted Types routing is missing ${tokens.join(' or ')}.`,
      );
    }
  }

  if (mode === 'readable' && !installerSource.includes(applySource)) {
    throw new Error(
      'Inline Kovo loader readable source must embed the Trusted Types-routed response-apply closure.',
    );
  }
}

function assertInlineKovoLoaderInstallerHelperParity(
  spec: InlineHelperSpec,
  installerSource: string,
  helperSource: string,
): void {
  assertInlineKovoLoaderInstallerHelperContains(
    installerSource,
    extractInlineHelperReadableSourceForSpec(spec, helperSource),
    spec.readableParityLabel,
    'readable',
  );
}

function assertMinifiedInlineKovoLoaderInstallerHelperParity(
  spec: InlineHelperSpec,
  installerSource: string,
  helperSource: string,
): void {
  const expectedSource = extractInlineHelperReadableSourceForSpec(spec, helperSource);
  const expected = minifyInlineJavaScriptSource(expectedSource);
  const compactExpected = minifyInlineJavaScriptSource(
    compactInlineKovoLoaderInstallerLocalNames(expectedSource),
  );

  if (
    countSubstring(installerSource, expected) === 1 ||
    countSubstring(installerSource, compactExpected) === 1
  ) {
    return;
  }

  throw new Error(
    `Inline Kovo loader minified source must embed the ${spec.minifiedParityLabel} exactly once; found 0.`,
  );
}

function compactInlineKovoLoaderInstallerLocalNames(source: string): string {
  // SPEC.md §4.4: the always-loaded bootstrap has a hard gzip ceiling. Keep
  // source modules readable, then compact only closure-local helper names before
  // the parse-checked minifier runs.
  const replacements = new Map([
    ['readMutationResponseBodyCore', 'rb'],
    ['readInlineMutationResponseBodyChunks', 'ri'],
    ['readMutationResponseElementChunks', 'rc'],
    ['readFragmentChunksFromElements', 'rfs'],
    ['readFragmentElementChunk', 'rf'],
    ['readStreamTextChunksFromElements', 'rtc'],
    ['readStreamTextElementChunk', 'rte'],
    ['readWireElementTokens', 'rwt'],
    ['readWireAttributes', 'rwa'],
    ['readWireElementAttribute', 'rwe'],
    ['matchingWireElementEnd', 'mwe'],
    ['findWireClosingTagStart', 'fwc'],
    ['findWireTagStart', 'fwt'],
    ['matchesWireTagName', 'mwt'],
    ['isHtmlAttributeWhitespace', 'ihw'],
    ['isHtmlAttributeNameTerminator', 'iat'],
    ['installEnhancedNavigationRuntime', 'ien'],
    ['createDocumentLifecycleRecovery', 'cdr'],
    ['applyInlineMutationResponseChunks', 'ai'],
    ['isFragmentResourceHint', 'irh'],
    // SF (secure-framework Tier 3): the inline Trusted Types createHTML shim
    // (response-fragment-apply.ts) and its policy handle, compacted to reclaim gzip
    // headroom under the SPEC.md §4.4 budget.
    ['trustedHtml', 'th'],
    ['firstMorphElement', 'fme'],
    ['findFragmentTarget', 'ff'],
    ['readElementChunks', 're'],
    ['matchingElementEnd', 'me'],
    ['escapeRegExp', 'er'],
    ['readAttribute', 'ra'],
    ['unescapeHtml', 'uh'],
    ['escapeCssString', 'ecs'],
    ['tagClose', 'tc'],
    ['openingEnd', 'oe'],
    ['closingTag', 'ct'],
    ['elementTag', 'et'],
    ['closeStart', 'cs'],
    ['queryOptions', 'qo'],
    ['queries', 'qs'],
    ['fragmentOptions', 'fo'],
    ['onMalformedQuery', 'oq'],
    ['onMalformedFragment', 'of'],
    ['onMalformed', 'om'],
    ['element', 'el'],
    ['current', 'cur'],
    ['segment', 'seg'],
    ['attribute', 'attr'],
    ['response', 'res'],
    // Installer-local helper names (not referenced by the parity-checked helper
    // closures); compacting them reclaims gzip headroom for the M10 selector
    // guard within the SPEC.md §4.4 bootstrap ceiling.
    ['dispatch', 'dp'],
    ['targetIdentity', 't'],
    ['liveTargetIdentity', 'lti'],
    ['liveProps', 'lp'],
    ['trigger', 'tg'],
    ['crossing', 'cr'],
    ['enterType', 'en'],
    ['overType', 'ov'],
    ['selector', 'sl'],
    ['component', 'cp'],
    ['island', 'is'],
    ['existing', 'ex'],
    ['controller', 'ac'],
    ['nextHtml', 'nh'],
    ['requestedUrl', 'ru'],
    ['finalUrl', 'fu'],
    ['contentType', 'cty'],
    ['currentSegments', 'csg'],
    ['nextSegments', 'nsg'],
    ['triggerRoot', 'trg'],
    ['focusTarget', 'fot'],
    ['applyTexts', 'apt'],
    ['textEnd', 'te'],
    ['complete', 'cm'],
    ['streaming', 'sg'],
    ['formIdem', 'fi'],
    ['reader', 'rr'],
    ['decoder', 'de'],
    ['pending', 'pg'],
    ['source', 'src'],
    ['render', 'rn'],
  ]);
  return replaceInlineLoaderIdentifierTokens(source, replacements);
}

function replaceInlineLoaderIdentifierTokens(
  source: string,
  replacements: ReadonlyMap<string, string>,
): string {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    source,
  );
  let output = '';
  let cursor = 0;

  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind !== ts.SyntaxKind.Identifier) continue;

    const tokenStart = scanner.getTokenPos();
    const tokenEnd = scanner.getTextPos();
    const replacement = replacements.get(source.slice(tokenStart, tokenEnd));
    if (replacement === undefined) continue;

    output += source.slice(cursor, tokenStart);
    output += replacement;
    cursor = tokenEnd;
  }

  return `${output}${source.slice(cursor)}`;
}

function assertInlineKovoLoaderInstallerHelperContains(
  installerSource: string,
  expected: string,
  parityLabel: string,
  sourceKind: 'minified' | 'readable',
): void {
  const count = countSubstring(installerSource, expected);

  if (count !== 1) {
    throw new Error(
      `Inline Kovo loader ${sourceKind} source must embed the ${parityLabel} exactly once; found ${count}.`,
    );
  }
}

function assertDefaultInlineKovoLoaderInstallerHelperParity(source: string): void {
  if (source !== inlineKovoLoaderInstallerReadableSource) return;
  for (const spec of Object.values(inlineHelperSpecs)) {
    assertInlineKovoLoaderInstallerHelperParity(
      spec,
      source,
      readInlineHelperCanonicalSource(spec),
    );
  }
}

function assertDefaultMinifiedInlineKovoLoaderInstallerHelperParity(
  readableSource: string,
  installerSource: string,
): void {
  if (readableSource !== inlineKovoLoaderInstallerReadableSource) return;
  for (const spec of Object.values(inlineHelperSpecs)) {
    assertMinifiedInlineKovoLoaderInstallerHelperParity(
      spec,
      installerSource,
      readInlineHelperCanonicalSource(spec),
    );
  }
}

function countSubstring(source: string, expected: string): number {
  if (!expected) return 0;

  let count = 0;
  let offset = 0;
  while (offset < source.length) {
    const index = source.indexOf(expected, offset);
    if (index === -1) return count;

    count += 1;
    offset = index + expected.length;
  }

  return count;
}

function collectInlineHelperDependencyClosure(
  label: string,
  sourceFile: ts.SourceFile,
  declarations: ReadonlyMap<string, ts.FunctionDeclaration>,
  unsupportedTopLevelBindings: ReadonlySet<string>,
  rootFunctionNames: readonly string[],
): Set<string> {
  const included = new Set<string>();
  const visiting = new Set<string>();

  const include = (name: string): void => {
    if (included.has(name)) return;
    if (visiting.has(name)) return;

    const declaration = declarations.get(name);
    if (!declaration) {
      throw new Error(`Inline Kovo loader ${label} source is missing helper: ${name}`);
    }

    visiting.add(name);
    for (const dependency of collectInlineHelperFunctionDependencies(
      label,
      sourceFile,
      declaration,
      declarations,
      unsupportedTopLevelBindings,
    )) {
      include(dependency);
    }
    included.add(name);
    visiting.delete(name);
  };

  for (const name of rootFunctionNames) include(name);
  return included;
}

function collectInlineHelperFunctionDependencies(
  label: string,
  sourceFile: ts.SourceFile,
  declaration: ts.FunctionDeclaration,
  declarations: ReadonlyMap<string, ts.FunctionDeclaration>,
  unsupportedTopLevelBindings: ReadonlySet<string>,
): Set<string> {
  const dependencies = new Set<string>();
  const ownName = declaration.name?.text;
  const isLocallyBound = (name: string, scopes: readonly ReadonlySet<string>[]): boolean =>
    scopes.some((scope) => scope.has(name));

  const visit = (node: ts.Node, scopes: readonly ReadonlySet<string>[]): void => {
    if (node === declaration.name) return;

    if (isFunctionLikeWithBody(node)) {
      visitFunctionLike(node, scopes);
      return;
    }

    if (ts.isBlock(node)) {
      visitBlock(node, scopes);
      return;
    }

    if (ts.isParameter(node)) {
      visitBindingName(node.name, scopes);
      if (node.initializer) visit(node.initializer, scopes);
      return;
    }

    if (ts.isVariableDeclaration(node)) {
      visitBindingName(node.name, scopes);
      if (node.initializer) visit(node.initializer, scopes);
      return;
    }

    if (ts.isBindingElement(node)) {
      if (node.propertyName && ts.isComputedPropertyName(node.propertyName)) {
        visit(node.propertyName.expression, scopes);
      }
      if (node.initializer) visit(node.initializer, scopes);
      return;
    }

    if (ts.isPropertyAccessExpression(node)) {
      visit(node.expression, scopes);
      return;
    }

    if (ts.isPropertyAssignment(node)) {
      if (ts.isComputedPropertyName(node.name)) visit(node.name.expression, scopes);
      visit(node.initializer, scopes);
      return;
    }

    if (ts.isIdentifier(node)) {
      const name = node.text;
      const local = isLocallyBound(name, scopes);
      if (name !== ownName && declarations.has(name) && !local) dependencies.add(name);
      if (unsupportedTopLevelBindings.has(name) && !declarations.has(name) && !local) {
        throw new Error(
          `Inline Kovo loader ${label} helper ${ownName ?? '<anonymous>'} references top-level binding ${name}, but inline extraction only supports self-contained top-level function declarations.`,
        );
      }
    }

    ts.forEachChild(node, (child) => visit(child, scopes));
  };

  const visitFunctionLike = (
    functionNode: ts.SignatureDeclarationBase & { body?: ts.ConciseBody },
    parentScopes: readonly ReadonlySet<string>[],
  ): void => {
    const functionScope = new Set<string>();
    if (
      (ts.isFunctionDeclaration(functionNode) || ts.isFunctionExpression(functionNode)) &&
      functionNode.name
    ) {
      functionScope.add(functionNode.name.text);
    }
    for (const parameter of functionNode.parameters) {
      addInlineHelperBindingName(parameter.name, functionScope);
    }

    const functionScopes = [functionScope, ...parentScopes];
    for (const parameter of functionNode.parameters) {
      visitBindingName(parameter.name, functionScopes);
      if (parameter.initializer) visit(parameter.initializer, functionScopes);
    }

    if (!functionNode.body) return;
    if (ts.isBlock(functionNode.body)) {
      visitBlock(functionNode.body, functionScopes);
      return;
    }
    visit(functionNode.body, functionScopes);
  };

  const visitBindingName = (
    name: ts.BindingName | ts.Identifier,
    scopes: readonly ReadonlySet<string>[],
  ): void => {
    if (ts.isIdentifier(name)) return;
    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) continue;
      if (element.propertyName && ts.isComputedPropertyName(element.propertyName)) {
        visit(element.propertyName.expression, scopes);
      }
      visitBindingName(element.name, scopes);
      if (element.initializer) visit(element.initializer, scopes);
    }
  };

  const visitBlock = (block: ts.Block, parentScopes: readonly ReadonlySet<string>[]): void => {
    const blockScope = new Set<string>();
    collectInlineHelperStatementBindings(block.statements, blockScope);
    const blockScopes = [blockScope, ...parentScopes];
    for (const statement of block.statements) {
      visit(statement, blockScopes);
    }
  };

  visitFunctionLike(declaration, []);
  return dependencies;
}

function isFunctionLikeWithBody(
  node: ts.Node,
): node is ts.SignatureDeclarationBase & { body?: ts.ConciseBody } {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function collectInlineHelperStatementBindings(
  statements: ts.NodeArray<ts.Statement>,
  bindings: Set<string>,
): void {
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      bindings.add(statement.name.text);
      continue;
    }
    if (ts.isClassDeclaration(statement) && statement.name) {
      bindings.add(statement.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        addInlineHelperBindingName(declaration.name, bindings);
      }
    }
  }
}

function addInlineHelperBindingName(
  name: ts.BindingName | ts.Identifier,
  bindings: Set<string>,
): void {
  if (ts.isIdentifier(name)) {
    bindings.add(name.text);
    return;
  }

  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    addInlineHelperBindingName(element.name, bindings);
  }
}

function collectUnsupportedInlineHelperTopLevelBindings(sourceFile: ts.SourceFile): Set<string> {
  const bindings = new Set<string>();

  const addImportClauseBindings = (clause: ts.ImportClause): void => {
    if (clause.name) bindings.add(clause.name.text);
    if (!clause.namedBindings) return;
    if (ts.isNamespaceImport(clause.namedBindings)) {
      bindings.add(clause.namedBindings.name.text);
      return;
    }
    for (const specifier of clause.namedBindings.elements) {
      bindings.add(specifier.name.text);
    }
  };

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      addImportClauseBindings(statement.importClause);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        addInlineHelperBindingName(declaration.name, bindings);
      }
      continue;
    }
    if (ts.isClassDeclaration(statement) && statement.name) {
      bindings.add(statement.name.text);
      continue;
    }
    if (ts.isEnumDeclaration(statement)) {
      bindings.add(statement.name.text);
    }
  }

  return bindings;
}

export function assertInlineKovoLoaderModuleArtifactParity(
  moduleSource: string,
  label = 'Inline Kovo loader module',
): void {
  const sourceFile = parseInlineKovoLoaderModuleSource(moduleSource, label);
  let installerLiteralSource: string | undefined;
  let installerFunctionSource: string | undefined;

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (node.name.text === 'inlineKovoLoaderInstallerSource') {
        installerLiteralSource = readInlineInstallerSourceLiteral(node.initializer);
      }
      if (node.name.text === 'inlineKovoLoaderInstaller') {
        const expression = unwrapInlineInstallerExpression(node.initializer);
        if (ts.isFunctionExpression(expression)) {
          installerFunctionSource = expression.getText(sourceFile);
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (installerLiteralSource === undefined) {
    throw new Error(`${label} is missing inlineKovoLoaderInstallerSource.`);
  }
  if (installerFunctionSource === undefined) {
    throw new Error(`${label} is missing inlineKovoLoaderInstaller function artifact.`);
  }
  if (installerLiteralSource !== installerFunctionSource) {
    throw new Error(
      `${label} embedded installer artifacts drifted: inlineKovoLoaderInstallerSource does not match inlineKovoLoaderInstaller.`,
    );
  }
}

function parseInlineKovoLoaderModuleSource(moduleSource: string, label: string): ts.SourceFile {
  const sourceFile = ts.createSourceFile(
    'inline-loader.ts',
    moduleSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const [diagnostic] =
    (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics ?? [];
  if (diagnostic) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    throw new Error(`${label} is invalid TypeScript: ${message}`);
  }

  return sourceFile;
}

function readInlineInstallerSourceLiteral(expression: ts.Expression): string | undefined {
  const unwrapped = unwrapInlineInstallerExpression(expression);
  if (ts.isNoSubstitutionTemplateLiteral(unwrapped) || ts.isStringLiteral(unwrapped)) {
    return unwrapped.text;
  }

  return undefined;
}

function unwrapInlineInstallerExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

export function emitInlineKovoLoaderModule(
  options: EmitInlineKovoLoaderModuleOptions = {},
): EmitInlineKovoLoaderModuleResult {
  const targetPath = options.targetPath ?? inlineKovoLoaderModulePath;
  const source =
    options.source === undefined
      ? buildInlineKovoLoaderModuleSource()
      : buildInlineKovoLoaderModuleSource(options.source);
  const current = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : undefined;
  const changed = current !== source;

  if (options.check) {
    if (current !== undefined) {
      assertInlineKovoLoaderModuleArtifactParity(current, targetPath);
    }
    if (changed) {
      throw new Error(
        `Inline Kovo loader module is stale: ${targetPath}. Run pnpm --filter @kovojs/browser run build:inline-loader.`,
      );
    }
    return { changed, source, targetPath };
  }

  if (changed) writeFileSync(targetPath, source, 'utf8');

  return { changed, source, targetPath };
}

function inlineJavaScriptTemplateLiteral(value: string): string {
  return `\`${value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')}\``;
}

function createInlineKovoLoaderBootstrapSource(
  installerSource: string,
  runtimeModuleExpression = JSON.stringify('/c/kovo-runtime.client.js'),
  runtimeImportExpression = '(url)=>import(url)',
): string {
  return `(${installerSource})(${runtimeModuleExpression},${runtimeImportExpression});`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = emitInlineKovoLoaderModule({ check: process.argv.includes('--check') });

  if (!process.argv.includes('--check')) {
    console.log(
      `${result.changed ? 'Wrote' : 'Unchanged'} ${result.targetPath} from inline-loader-build.ts.`,
    );
  }
}
