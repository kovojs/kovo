import { Buffer as NativeBuffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lstat, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
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
const trustedTypesSourcePath = fileURLToPath(new URL('./trusted-types.ts', import.meta.url));

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
    rootFunctionNames: ['createMutationIdemSecurityControls', 'installEnhancedNavigationRuntime'],
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
  trustedTypes: {
    label: 'Trusted Types security controls',
    readableParityLabel: 'canonical Trusted Types security-control closure',
    minifiedParityLabel: 'canonical minified Trusted Types security-control closure',
    rootFunctionNames: ['createKovoTrustedTypesSecurityControls'],
    sourceFileName: 'trusted-types.ts',
    sourcePath: trustedTypesSourcePath,
    sourcePaths: [trustedTypesSourcePath],
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
export const inlineTrustedTypesReadableSource = readInlineTrustedTypesReadableSource();
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
  trustedTypesReadableSource = inlineTrustedTypesReadableSource,
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
  ${trustedTypesReadableSource}
  const tts = createKovoTrustedTypesSecurityControls();
  const bns = createBrowserNavigationSecurityControls();
  const mis = createMutationIdemSecurityControls();
  const intrinsicJson = JSON;
  const intrinsicJsonParse = intrinsicJson.parse;
  const ci = () => mis.createMutationIdem();
  const rh = (el) =>
    bns.closestElement(el, '[kovo-state]') ??
    (bns.readAttribute(el, 'kovo-state') === null ? null : el);
  const rs = (el) => {
    try {
      return bns.call(intrinsicJsonParse, intrinsicJson, [
        bns.readAttribute(rh(el), 'kovo-state') ?? '{}',
      ]);
    } catch {
      return {};
    }
  };
  const qa = (root, selector) => bns.queryAllElements(root, selector);
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
      const l = bns.currentUrl();
      if (!l) return false;
      const p = bns.parseUrl(url, l.href);
      if (!p) return false;
      if (p.origin !== l.origin) return false;
      const pn = p.pathname;
      if (
        bns.regExpTest(/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/, p.origin) &&
        bns.indexOf(pn, '/c/') !== 0 &&
        bns.regExpTest(/\.(?:[cm]?tsx?)$/, pn)
      ) {
        return true;
      }
      if (bns.indexOf(pn, '/c/') !== 0) return false;
      const k = p.origin + pn + p.search;
      const allowlistMarkers = bns.queryAllElements(doc, '[data-kovo-module-allowlist]');
      for (let markerIndex = 0; markerIndex < allowlistMarkers.length; markerIndex += 1) {
        const a = allowlistMarkers[markerIndex];
        if (!a) continue;
        const declared =
          bns.readAttribute(a, 'data-kovo-module-allowlist') ||
          bns.readAttribute(a, 'href') ||
          '';
        let href = '';
        for (let index = 0; index <= declared.length; index += 1) {
          const character = declared[index];
          if (character !== undefined && !bns.regExpTest(/\s/, character)) {
            href += character;
            continue;
          }
          if (!href) continue;
          try {
            const u = bns.parseUrl(href, l.href);
            if (
              u &&
              u.origin === l.origin &&
              bns.indexOf(u.pathname, '/c/') === 0 &&
              u.origin + u.pathname + u.search === k
            ) {
              return true;
            }
          } catch {}
          href = '';
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
  const oe = (carrier, name) => {
    if (carrier === null || typeof carrier !== 'object') return;
    const descriptor = bns.getOwnSecurityPropertyDescriptor(carrier, name);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  };
  const ras = (carrier, name) => {
    const attribute = bns.readAttribute(carrier, name);
    if (attribute !== null) return attribute;
    const value = oe(carrier, name);
    return typeof value === 'string' ? value : null;
  };
  const dr = (mod, name, state) => {
    const derive = oe(mod, name);
    const run = oe(derive, 'run');
    return typeof run === 'function' ? bns.call(run, derive, [state]) : undefined;
  };
  const sh = (el, host) =>
    el === host || bns.closestElement(el, '[kovo-state]') === host;
  const bindingAttributes = (el, prefix) => {
    const attributes = bns.snapshotElementAttributes(el);
    const bindings = [];
    for (let index = 0; index < attributes.length; index += 1) {
      const attribute = attributes[index];
      if (!attribute || bns.indexOf(attribute.name, prefix) !== 0 || !attribute.value) continue;
      bns.appendDenseSecurityValue(bindings, attribute, 'Inline binding attribute snapshot');
    }
    return bindings;
  };
  const ba = (el) => bindingAttributes(el, 'data-bind:');
  const wa = (el, name, val) => {
    const n = name.toLowerCase();
    // SPEC.md section 5.2.4: a dialog opened via the native show-modal invoker
    // lives in the top layer. Toggling its open attribute alone never exits the
    // top layer (it stays :modal with an inert backdrop intercepting every
    // click), so drive the reactive open/close through the dialog methods that
    // keep top-layer state in sync. Guards keep this idempotent against the
    // native invoker call that opens the dialog on the same activation.
    if (name === 'open' && bns.lower(bns.readElementTagName(el) || '') === 'dialog' && typeof el.close === 'function') {
      if (val != null && val !== false) {
        if (bns.readElementProperty(el, 'open') !== true) {
          if (bns.readAttribute(el, 'aria-modal') === 'true' && typeof el.showModal === 'function') {
            el.showModal();
          } else if (typeof el.show === 'function') el.show();
          else bns.setElementAttribute(el, 'open', '');
        }
      } else if (bns.readElementProperty(el, 'open') === true) el.close();
      return;
    }
    // SPEC.md §4.6/§4.8: HTML boolean-presence attributes use presence, not
    // stringified booleans. Keep inline data-bind:* in parity with the module
    // query/state runtime for the full boolean-presence set.
    if (/^(?:${inlineBooleanPresenceAttributes.join('|')})$/.test(n)) {
      const on = val != null && val !== false;
      if (on) bns.setElementAttribute(el, name, '');
      else bns.removeElementAttribute(el, name);
      if (n === 'checked' && bns.readElementProperty(el, 'checked') !== undefined) {
        bns.setElementProperty(el, 'checked', on);
      }
      if (n === 'indeterminate' && bns.readElementProperty(el, 'indeterminate') !== undefined) {
        bns.setElementProperty(el, 'indeterminate', on);
      }
      return;
    }
    if (val == null) bns.removeElementAttribute(el, name);
    else {
      if (r(n)) bns.removeElementAttribute(el, name);
      else {
        let r = fb(val);
        if (n === 'style' && c(r, bns)) {
          bns.removeElementAttribute(el, name);
        } else if (n === 'srcset' || n === 'imagesrcset') {
          const a = s(r);
          if (a) bns.setElementAttribute(el, name, a);
          else bns.removeElementAttribute(el, name);
        } else {
          if (ia(name) && uu(r)) r = '#';
          bns.setElementAttribute(el, name, r);
        }
      }
    }
    if (name === 'value' && bns.readElementProperty(el, 'value') !== undefined) {
      if (val != null) bns.setElementProperty(el, 'value', fb(val));
      else if (bns.lower(bns.readElementTagName(el) || '') !== 'progress') {
        bns.setElementProperty(el, 'value', '');
      }
    }
    if (
      (name === 'scrollLeft' || name === 'scrollleft') &&
      bns.readElementProperty(el, 'scrollLeft') !== undefined
    ) {
      bns.setElementProperty(el, 'scrollLeft', Number(val) || 0);
    }
    if (
      (name === 'scrollTop' || name === 'scrolltop') &&
      bns.readElementProperty(el, 'scrollTop') !== undefined
    ) {
      bns.setElementProperty(el, 'scrollTop', Number(val) || 0);
    }
  };
  const ws = (el, path, bt, state, root = 'state') => {
    if (!path?.startsWith(root + '.')) return;
    const val = vp(state, path.slice(root.length + 1));
    if (bt) {
      wa(el, bt, val);
    } else {
      // SPEC §4.8: data-bind is textContent; form values use data-bind:value.
      bns.setNodeTextContent(el, fb(val));
    }
  };
  // SPEC.md §4.8 data-bind-prop: exact branches keep the property-authoritative
  // allowlist closed even when app code pollutes Object.prototype. HTML parsers
  // lowercase attribute names; the camelcase spellings support synthetic roots.
  // 0=bool,1=number,2=string.
  const bpc = (suffix) =>
    suffix === 'checked' ? ['checked', 0] :
    suffix === 'indeterminate' ? ['indeterminate', 0] :
    suffix === 'selected' ? ['selected', 0] :
    suffix === 'open' ? ['open', 0] :
    suffix === 'scrolltop' || suffix === 'scrollTop' ? ['scrollTop', 1] :
    suffix === 'scrollleft' || suffix === 'scrollLeft' ? ['scrollLeft', 1] :
    suffix === 'value' ? ['value', 2] : undefined;
  const bp = (el) => bindingAttributes(el, 'data-bind-prop:');
  const wp = (el, suffix, val) => {
    const spec = bpc(suffix);
    if (!spec) return;
    const prop = spec[0];
    if (bns.readElementProperty(el, prop) === undefined) return;
    // <progress>.value is not dirty/user-interactive; null=indeterminate (no attr),
    // so skip the string write (data-bind:value owns progress). Mirrors wa().
    if (spec[1] === 2 && bns.lower(bns.readElementTagName(el) || '') === 'progress') return;
    bns.setElementProperty(
      el,
      prop,
      spec[1] === 0 ? val != null && val !== false : spec[1] === 1 ? Number(val) || 0 : fb(val),
    );
  };
  const as = async (host, state) => {
    const derives = [];
    const queueDerive = (el, ref, suffix, property) => {
      let hi = ref.length - 1;
      while (hi >= 0 && bns.charCode(ref, hi) !== 35) hi -= 1;
      if (hi <= 0 || hi === ref.length - 1) return false;
      bns.appendDenseSecurityValue(
        derives,
        {
          el,
          exportName: bns.slice(ref, hi + 1),
          property,
          suffix,
          url: bns.slice(ref, 0, hi),
        },
        'Inline state derive binding snapshot',
      );
      return true;
    };
    const hb = bns.readAttribute(host, 'data-bind');
    if (!hb || !queueDerive(host, hb, undefined, false)) ws(host, hb, undefined, state);
    const textElements = qa(host, '[data-bind]');
    for (let index = 0; index < textElements.length; index += 1) {
      const el = textElements[index];
      if (!el) continue;
      if (sh(el, host)) {
        const binding = bns.readAttribute(el, 'data-bind');
        if (!binding || !queueDerive(el, binding, undefined, false)) {
          ws(el, binding, undefined, state);
        }
      }
    }
    const allElements = [host];
    const descendants = qa(host, '*');
    for (let index = 0; index < descendants.length; index += 1) {
      const element = descendants[index];
      if (element) {
        bns.appendDenseSecurityValue(
          allElements,
          element,
          'Inline state binding element snapshot',
        );
      }
    }
    for (let index = 0; index < allElements.length; index += 1) {
      const el = allElements[index];
      if (!el) continue;
      if (!sh(el, host)) continue;
      const attributes = ba(el);
      for (let attrIndex = 0; attrIndex < attributes.length; attrIndex += 1) {
        const attr = attributes[attrIndex];
        if (!attr) continue;
        const suffix = bns.slice(attr.name, 'data-bind:'.length);
        if (!queueDerive(el, attr.value, suffix, false)) {
          ws(el, attr.value, suffix, state);
        }
      }
      // SPEC.md §4.8 data-bind-prop: live property write after the attribute pass.
      const properties = bp(el);
      for (let propertyIndex = 0; propertyIndex < properties.length; propertyIndex += 1) {
        const attr = properties[propertyIndex];
        if (!attr) continue;
        const suffix = bns.slice(attr.name, 'data-bind-prop:'.length);
        if (!queueDerive(el, attr.value, suffix, true) && bns.indexOf(attr.value, 'state.') === 0) {
          wp(el, suffix, vp(state, bns.slice(attr.value, 6)));
        }
      }
    }
    // SPEC §6.6: no authored derive module runs until every later import/callee reference in the
    // same commit has been reduced to framework-owned URL/export data.
    for (let index = 0; index < derives.length; index += 1) {
      const binding = derives[index];
      if (!binding) continue;
      const mod = await im(binding.url);
      const value = dr(mod, binding.exportName, state);
      if (binding.property) {
        wp(binding.el, binding.suffix, value);
      } else if (binding.suffix) {
        wa(binding.el, binding.suffix, value);
      } else {
        bns.setNodeTextContent(binding.el, fb(value));
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
    ras(el, 'kovo-fragment-target') ?? ras(el, 'id') ?? ras(el, 'kovo-c') ?? '';
  const liveTargetIdentity = (el) =>
    ras(el, 'kovo-live-component') ??
    ras(el, 'kovo-c') ??
    targetIdentity(el);
  const liveProps = (el) => {
    try {
      const props = bns.call(intrinsicJsonParse, intrinsicJson, [
        ras(el, 'kovo-props') || '{}',
      ]);
      return props && typeof props === 'object' && !Array.isArray(props) ? props : {};
    } catch {
      return {};
    }
  };
  const rt = () => [
    ...new Set(
      [...doc.querySelectorAll('[kovo-deps]')]
        .map((el) => {
          const deps = rd(ras(el, 'kovo-deps'));
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
      const token = ras(el, 'kovo-live-token');
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
  const hs = (el) =>
    ((el = bns.closestElement(el, '[kovo-c]') || el).a ||= new AbortController()).signal;
  const kb = (root = doc) => {
    const meta = bns.queryOne(root, 'meta[name="kovo-build"]');
    return meta ? bns.readAttribute(meta, 'content') || '' : '';
  };
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
      bns.setNodeTextContent(fresh, bns.readNodeTextContent(old) ?? '');
      old.replaceWith(fresh);
    }
  };
  const hk = (el) => {
    if (el.nodeType !== 1) return '';
    if (el.tagName === 'STYLE') {
      const criticalHref = el.getAttribute('data-kovo-critical-href');
      return criticalHref ? ['style', criticalHref, bns.readNodeTextContent(el) || ''].join('|') : '';
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
    morph: (current, next) => m(current, next, bns),
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
    addLifecycleEventListener: (type, listener) =>
      bns.addLifecycleEventListener(globalThis, type, listener),
    applyBody: fab,
    buildHeader: bh,
    currentBuild: kb,
    currentHref: () => bns.currentUrl()?.href,
    document: doc,
    encodeAttribute: ea,
    fetchValue: (input, init) => bns.fetchValue(input, init),
    findTarget: ftd,
    liveTargets: rlt,
    parseHtmlDocument: (value) => bns.parseHtmlDocument(value),
    queryOne: (root, selector) => bns.queryOne(root, selector),
    queryAll: qa,
    queryUrl: qurl,
    'readAttribute': (attrs, name) => readAttribute(attrs, name),
    readElementAttribute: readWireElementAttribute,
    readDomAttribute: (element, name) => bns.ra(element, name),
    readPageTransitionPersisted: (event) => bns.readPageTransitionPersisted(event),
    readResponseStatus: (response) => {
      const status = bns.readResponseField(response, 'status');
      return typeof status === 'number' ? status : undefined;
    },
    readResponseText: (response) => bns.readResponseText(response),
    reload: () => bns.reload(),
    snapshotElementHtml: (element) => bns.readElementOuterHtml(element),
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
    applyInlineMutationResponseChunks(
      { fragments },
      { createHTML: (html) => tts.createHTML(html), findFragmentTarget: ft, security: bns },
    );
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
    const ref = bns.readAttribute(el, 'data-stream-renderer');
    const hi = ref?.lastIndexOf('#') ?? -1;
    if (hi <= 0 || hi === ref.length - 1) return;
    const mod = await im(ref.slice(0, hi));
    const render = oe(mod, ref.slice(hi + 1));
    if (typeof render === 'function') await bns.call(render, undefined, [el, source, {}]);
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
      const source =
        x.mode === 'checkpoint' ? text : (st[x.target] ?? bns.readNodeTextContent(el) ?? '') + text;
      st[x.target] = source;
      se[x.target] = el;
      bns.setNodeTextContent(el, source);
      el.setAttribute?.('data-stream-state', 'streaming');
      void (async () => {
        try {
          await sr(el, source);
        } catch {}
      })();
    }
    return !missing;
  };
  const sfail = () => {
    for (const key in se) se[key].setAttribute?.('data-stream-state', 'error');
  };
  const ax = (chunks) => {
    const textStart = chunks.texts[0]?.start ?? 1 / 0;
    const before = [];
    const after = [];
    for (let index = 0; index < chunks.fragments.length; index += 1) {
      const chunk = chunks.fragments[index];
      if (!chunk) continue;
      const target = chunk.start < textStart ? before : after;
      bns.appendDenseSecurityValue(target, chunk, 'Kovo streaming fragment partition');
    }
    af(readFragmentChunksFromElements(before));
    const appliedTexts = at(readStreamTextChunksFromElements(chunks.texts));
    af(readFragmentChunksFromElements(after));
    return appliedTexts;
  };
  const streamRecoveryError = {};
  const recoverStream = async (source, reader = false) => {
    try {
      // Cancellation is best effort and must not let a hostile/stuck underlying source delay the
      // security recovery. Attach a rejection sink, then hard-reload immediately.
      const cancellation = reader
        ? bns.cancelStreamReader(source)
        : bns.cancelReadableStream(source);
      bns.observePromiseRejection(cancellation);
    } catch {}
    bns.reload();
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
    const reader = await bns.acquireStreamReader(body);
    const decoder = bns.createTextDecoder();
    const state = { done: false, queries: [] };
    let pending = '';
    try {
      while (true) {
        const read = await bns.readStreamChunk(reader);
        if (read.done) break;
        pending = cp(pending + bns.decodeText(decoder, read.value, { stream: true }), state);
      }
      pending += bns.decodeText(decoder);
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
      await recoverStream(reader, true);
      throw streamRecoveryError;
    } finally {
      bns.releaseStreamReader(reader);
    }
  };
  const fsb = (form) => {
    if (bns.submitForm(form)) return;
    form.setAttribute?.('data-error-code', 'NETWORK_ERROR');
    form.setAttribute?.('kovo-error', '');
  };
  const chg = (response) => {
    const value = bns.readHeader(response, 'Kovo-Changes');
    if (!value) return [];
    try {
      const parsed = bns.call(intrinsicJsonParse, intrinsicJson, [value]);
      const envelope = bns.snapshotMutationBroadcastEnvelopeData({
        body: '',
        changes: parsed,
        type: 'kovo:mutation-response',
      });
      return envelope?.changes ?? [];
    } catch {
      return [];
    }
  };
  const sessionMeta = bns.queryOne(doc, 'meta[name="kovo-session"]');
  const sfp = sessionMeta ? bns.readAttribute(sessionMeta, 'content') ?? undefined : undefined;
  let bc;
  let broadcastRetired = false;
  try {
    bc = bns.createMutationBroadcastChannel('kovo:mutation-response');
  } catch {}
  if (bc) {
    bns.observePromiseRejection(
      bns.setMutationBroadcastMessageHandler(bc, (event) => {
        if (broadcastRetired) return;
        const data = bns.snapshotMutationBroadcastEnvelope(event);
        if (broadcastRetired || !data || data.principal !== sfp) return;
        ab(data.body, data.buildToken);
      }, () => broadcastRetired),
    );
  }
  const pb = (body, changes) => {
    if (broadcastRetired || !bc) return;
    const envelope = bns.snapshotMutationBroadcastEnvelopeData({
      body,
      ...(kb() ? { buildToken: kb() } : {}),
      changes,
      ...(sfp === undefined ? {} : { principal: sfp }),
      type: 'kovo:mutation-response',
    });
    if (!envelope) return;
    bns.observePromiseRejection(
      bns.postMutationBroadcastEnvelope(bc, envelope, () => broadcastRetired),
    );
  };
  const rsp = (response, fallback = 0) => {
    const value = bns.readResponseField(response, 'status');
    return typeof value === 'number' && value >= 0 && value <= 999 ? value : fallback;
  };
  const rst = (response) =>
    bns.isTrimmedAsciiEqual(bns.readHeader(response, 'Kovo-Session-Transition'), 'reload');
  function retireBroadcast() {
    if (broadcastRetired) return;
    broadcastRetired = true;
    const channel = bc;
    bc = undefined;
    if (channel) bns.retireMutationBroadcastChannel(channel);
  }
  const retireSession = () => {
    retireBroadcast();
    bns.reload();
  };
  const ant = (form, body) => {
    const next = bns.safeSameOriginPath(bns.readFormDataValue(body, 'next'));
    if (next) return next;
    const current = bns.currentUrl();
    const action = current
      ? bns.parseUrl(ras(form, 'action') || '', current.href)
      : undefined;
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
  const sef = (event, form, submitter) => {
    if (!bns.preventDelegatedEventDefault(event)) return;
    const streaming = bns.readAttribute(form, 'data-mutation-stream') !== null;
    const body = bns.createFormData(form, submitter);
    const formIdem = bns.readFormDataValue(body, 'Kovo-Idem');
    const idem = typeof formIdem === 'string' && formIdem !== '' ? formIdem : ci();
    void (async () => {
      try {
        const response = await bns.fetchValue(ras(form, 'action') || '', {
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
          method: bns.upper(ras(form, 'method') || 'post'),
        });
        const status = rsp(response);
        // SPEC §9.3: retirement wins over every redirect/body channel; a response carrying
        // conflicting metadata cannot keep the old page-load principal alive.
        if (rst(response)) {
          retireSession();
          return;
        }
        const reauth = bns.readHeader(response, 'Kovo-Reauth');
        if (status === 401 && reauth) {
          // C180 / SPEC §6.5/§9.3: reauthentication is an expired-principal transition.
          // Retirement must precede a cancellable navigation to the sanitized login target.
          retireBroadcast();
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
            await recoverStream(responseBody);
            return;
          }
          await asr(responseBody);
          return;
        }
        const text = await bns.readResponseText(response);
        const changes = chg(response);
        if (eaf(response, changes, text)) {
          // C176 / SPEC §9.3: the accepted empty-auth fallback is a principal transition even
          // without the explicit header. Retirement must precede a cancellable navigation.
          retireBroadcast();
          ng(ant(form, body));
          return;
        }
        ab(text, bh(response));
        const completedStatus = rsp(response, 200);
        if (completedStatus >= 200 && completedStatus < 300 && bns.readResponseField(response, 'ok') !== false) {
          pb(text, changes);
        }
      } catch (error) {
        if (error !== streamRecoveryError) fsb(form);
      }
    })();
  };
  const rp = (el) =>
    (ras(el, 'kovo-param-types') || '').split(/[\s,]+/).reduce((types, entry) => {
      const [name, type] = entry.split(':');
      if (name) types[name] = type;
      return types;
    }, {},);
  const dispatch = async (event) => {
    const eventFacts = bns.snapshotDelegatedEvent(event);
    if (!eventFacts) return;
    const eventType = eventFacts.type;
    const eventTarget = eventFacts.target;
    if (eventType === 'submit') {
      const form = bns.closestElement(
        eventTarget,
        'form[enhance],form[data-enhance],form[data-mutation]',
      );
      if (form) {
        sef(event, form, eventFacts.submitter);
        return;
      }
    }
    if (eventType === 'click' && inav(event)) return;
    const el = bns.closestElement(eventTarget, '[on\\:' + eventType + ']');
    const refs = el ? bns.readAttribute(el, 'on:' + eventType) : null;
    if (!el || !refs) return;
    // SPEC.md §4.4: cancel the native context menu synchronously, in this
    // capture-phase prefix, before the awaited handler import below. An
    // on:contextmenu element opts into a custom menu, and deferring
    // preventDefault until after the await-import misses the dispatch window and
    // leaks the browser menu (the handler's own preventDefault runs too late).
    // The marker lets the chained primitive (SPEC.md §4.6 contextMenu open) tell
    // this framework native-suppression apart from a genuine author preventDefault
    // so it still opens the styled menu rather than treating itself as superseded.
    if (eventType === 'contextmenu' && eventFacts.cancelable && !eventFacts.defaultPrevented) {
      bns.preventDelegatedEventDefault(event);
      event.kovoNativeDefaultManaged = true;
    }
    const params = {};
    const pt = rp(el);
    const state = rs(el);
    const st = rh(el);
    const context = { params, state, signal: hs(el) };
    for (const attr of bns.snapshotElementAttributes(el)) {
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
      const fn = oe(mod, ref.slice(hi + 1));
      if (typeof fn !== 'function') throw Error('Handler export not found: ' + ref);
      const prev = globalThis.__kovo_postCommitSchedule;
      globalThis.__kovo_postCommitSchedule = (cb) => pc.push(cb);
      let run;
      try {
        run = bns.call(fn, undefined, [event, context]);
      } finally {
        globalThis.__kovo_postCommitSchedule = prev;
      }
      await run;
    }
    if (st) bns.setElementAttribute(st, 'kovo-state', JSON.stringify(state));
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
        const eventFacts = bns.snapshotDelegatedEvent(event);
        if (!eventFacts) return;
        const el = bns.closestElement(eventFacts.target, '[on\\:' + enterType + ']');
        if (!el || bns.elementContains(el, eventFacts.relatedTarget)) return;
        void dispatch({ relatedTarget: eventFacts.relatedTarget, target: el, type: enterType });
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
  // C210 / SPEC §6.6/§9.2: pin and witness the real form-submit fallback before deferred runtime
  // loading gives authored code a chance to replace HTMLFormElement.prototype.submit.
  const rap = Reflect.apply;
  const gopd = Object.getOwnPropertyDescriptor;
  const gpo = Object.getPrototypeOf;
  const odp = Object.defineProperty;
  const ownValue = (carrier, property) => {
    if ((typeof carrier !== 'object' && typeof carrier !== 'function') || carrier === null) {
      return undefined;
    }
    const descriptor = gopd(carrier, property);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  };
  const findDescriptor = (carrier, property) => {
    if ((typeof carrier !== 'object' && typeof carrier !== 'function') || carrier === null) {
      return undefined;
    }
    let owner = carrier;
    for (let depth = 0; owner !== null && depth < 16; depth += 1) {
      const descriptor = gopd(owner, property);
      if (descriptor !== undefined) return descriptor;
      owner = gpo(owner);
    }
    return undefined;
  };
  const capturedMethod = (carrier, property) => {
    const descriptor = findDescriptor(carrier, property);
    return descriptor && 'value' in descriptor && typeof descriptor.value === 'function'
      ? descriptor.value
      : undefined;
  };
  const capturedGetter = (carrier, property) => {
    const descriptor = findDescriptor(carrier, property);
    return descriptor && 'get' in descriptor && typeof descriptor.get === 'function'
      ? descriptor.get
      : undefined;
  };
  const readCaptured = (carrier, getter, property) => {
    if (typeof getter === 'function') {
      try {
        return rap(getter, carrier, []);
      } catch {}
    }
    return ownValue(carrier, property);
  };
  const callCaptured = (carrier, method, property, args) => {
    if (typeof method === 'function') {
      try {
        return { called: true, value: rap(method, carrier, args) };
      } catch {}
    }
    const fallback = ownValue(carrier, property);
    if (typeof fallback !== 'function') return { called: false, value: undefined };
    try {
      return { called: true, value: rap(fallback, carrier, args) };
    } catch {
      return { called: false, value: undefined };
    }
  };
  const submitControl = doc.createElement('form');
  const replayControl = doc.createElement('button');
  // SPEC.md §4.4/§6.6: bootstrap replay runs before the deferred runtime can protect the realm.
  // Capture and witness every replay control now so a late prototype/global replacement cannot
  // consume the prevented interaction or keep the capture listeners enrolled (C217).
  const NativeEvent = globalThis.Event;
  const NativeSubmitEvent = globalThis.SubmitEvent;
  const NativeMouseEvent = globalThis.MouseEvent;
  const NativeURL = globalThis.URL;
  const nativeEventType = capturedGetter(globalThis.Event?.prototype, 'type');
  const nativeEventTarget = capturedGetter(globalThis.Event?.prototype, 'target');
  const nativeEventDefaultPrevented = capturedGetter(
    globalThis.Event?.prototype,
    'defaultPrevented',
  );
  const nativePreventDefault = capturedMethod(globalThis.Event?.prototype, 'preventDefault');
  const nativeMouseButton = capturedGetter(globalThis.MouseEvent?.prototype, 'button');
  const nativeMouseMetaKey = capturedGetter(globalThis.MouseEvent?.prototype, 'metaKey');
  const nativeMouseCtrlKey = capturedGetter(globalThis.MouseEvent?.prototype, 'ctrlKey');
  const nativeMouseShiftKey = capturedGetter(globalThis.MouseEvent?.prototype, 'shiftKey');
  const nativeMouseAltKey = capturedGetter(globalThis.MouseEvent?.prototype, 'altKey');
  const nativeSubmitter = capturedGetter(globalThis.SubmitEvent?.prototype, 'submitter');
  const nativeClosest = capturedMethod(globalThis.Element?.prototype, 'closest');
  const nativeGetAttribute = capturedMethod(globalThis.Element?.prototype, 'getAttribute');
  const nativeHasAttribute = capturedMethod(globalThis.Element?.prototype, 'hasAttribute');
  const nativeIsConnected = capturedGetter(globalThis.Node?.prototype, 'isConnected');
  const nativeUrlHref = capturedGetter(globalThis.URL?.prototype, 'href');
  const nativeUrlOrigin = capturedGetter(globalThis.URL?.prototype, 'origin');
  const nativeUrlPathname = capturedGetter(globalThis.URL?.prototype, 'pathname');
  const nativeUrlSearch = capturedGetter(globalThis.URL?.prototype, 'search');
  const nativeUrlHash = capturedGetter(globalThis.URL?.prototype, 'hash');
  const browserLocation = globalThis.location;
  const nativeLocationHref = capturedGetter(browserLocation, 'href');
  const nativeLocationOrigin = capturedGetter(browserLocation, 'origin');
  const nativeLocationPathname = capturedGetter(browserLocation, 'pathname');
  const nativeLocationSearch = capturedGetter(browserLocation, 'search');
  const nativeLocationAssign = capturedMethod(browserLocation, 'assign');
  let nativeSubmit;
  let submitControlsReady = false;
  try {
    const submitDescriptor = gopd(globalThis.HTMLFormElement?.prototype, 'submit');
    nativeSubmit = submitDescriptor && 'value' in submitDescriptor
      ? submitDescriptor.value
      : undefined;
    if (
      typeof nativeSubmit !== 'function' ||
      rap((left, right) => left + right, undefined, [2, 3]) !== 5 ||
      gopd({ marker: 'submit-control' }, 'marker')?.value !== 'submit-control'
    ) {
      throw new TypeError('Kovo bootstrap form submit controls are unavailable.');
    }
    rap(nativeSubmit, submitControl, []);
    try {
      rap(nativeSubmit, {}, []);
    } catch {
      submitControlsReady = true;
    }
  } catch {}
  if (!submitControlsReady) {
    throw new TypeError('Kovo bootstrap form submit controls are unavailable.');
  }
  let nativeAddEventListener;
  let nativeRemoveEventListener;
  let nativeDispatchEvent;
  let replayControlsReady = false;
  try {
    const eventTargetPrototype = globalThis.EventTarget?.prototype;
    const addDescriptor = gopd(eventTargetPrototype, 'addEventListener');
    const removeDescriptor = gopd(eventTargetPrototype, 'removeEventListener');
    const dispatchDescriptor = gopd(eventTargetPrototype, 'dispatchEvent');
    nativeAddEventListener = addDescriptor && 'value' in addDescriptor
      ? addDescriptor.value
      : undefined;
    nativeRemoveEventListener = removeDescriptor && 'value' in removeDescriptor
      ? removeDescriptor.value
      : undefined;
    nativeDispatchEvent = dispatchDescriptor && 'value' in dispatchDescriptor
      ? dispatchDescriptor.value
      : undefined;
    if (
      typeof NativeEvent !== 'function' ||
      typeof NativeMouseEvent !== 'function' ||
      typeof NativeURL !== 'function' ||
      typeof nativeAddEventListener !== 'function' ||
      typeof nativeRemoveEventListener !== 'function' ||
      typeof nativeDispatchEvent !== 'function' ||
      typeof nativeEventType !== 'function' ||
      typeof nativeEventTarget !== 'function' ||
      typeof nativeEventDefaultPrevented !== 'function' ||
      typeof nativePreventDefault !== 'function' ||
      typeof nativeMouseButton !== 'function' ||
      typeof nativeMouseMetaKey !== 'function' ||
      typeof nativeMouseCtrlKey !== 'function' ||
      typeof nativeMouseShiftKey !== 'function' ||
      typeof nativeMouseAltKey !== 'function' ||
      (typeof NativeSubmitEvent === 'function' && typeof nativeSubmitter !== 'function') ||
      typeof nativeClosest !== 'function' ||
      typeof nativeGetAttribute !== 'function' ||
      typeof nativeHasAttribute !== 'function' ||
      typeof nativeIsConnected !== 'function' ||
      typeof nativeUrlHref !== 'function' ||
      typeof nativeUrlOrigin !== 'function' ||
      typeof nativeUrlPathname !== 'function' ||
      typeof nativeUrlSearch !== 'function' ||
      typeof nativeUrlHash !== 'function' ||
      typeof nativeLocationHref !== 'function' ||
      typeof nativeLocationOrigin !== 'function' ||
      typeof nativeLocationPathname !== 'function' ||
      typeof nativeLocationSearch !== 'function' ||
      typeof nativeLocationAssign !== 'function'
    ) {
      throw new TypeError('Kovo bootstrap replay controls are unavailable.');
    }
    const eventControl = new NativeMouseEvent('kovo-security-control:bootstrap-event', {
      button: 0,
      cancelable: true,
    });
    const propertyControl = {};
    odp(propertyControl, 'marker', { value: 'kovo-bootstrap-property-control' });
    const urlControl = new NativeURL('/control?ready=1#ok', 'https://kovo.invalid/root');
    const closestControl = callCaptured(replayControl, nativeClosest, 'closest', ['button']);
    const attributeControl = callCaptured(
      replayControl,
      nativeGetAttribute,
      'getAttribute',
      ['data-kovo-bootstrap-control'],
    );
    const hasAttributeControl = callCaptured(
      replayControl,
      nativeHasAttribute,
      'hasAttribute',
      ['data-kovo-bootstrap-control'],
    );
    if (
      readCaptured(eventControl, nativeEventType, 'type') !==
        'kovo-security-control:bootstrap-event' ||
      readCaptured(eventControl, nativeEventTarget, 'target') !== null ||
      readCaptured(eventControl, nativeEventDefaultPrevented, 'defaultPrevented') !== false ||
      readCaptured(eventControl, nativeMouseButton, 'button') !== 0 ||
      readCaptured(eventControl, nativeMouseMetaKey, 'metaKey') !== false ||
      readCaptured(eventControl, nativeMouseCtrlKey, 'ctrlKey') !== false ||
      readCaptured(eventControl, nativeMouseShiftKey, 'shiftKey') !== false ||
      readCaptured(eventControl, nativeMouseAltKey, 'altKey') !== false ||
      ownValue(propertyControl, 'marker') !== 'kovo-bootstrap-property-control' ||
      gpo(propertyControl) === null ||
      closestControl.called !== true ||
      closestControl.value !== replayControl ||
      attributeControl.called !== true ||
      attributeControl.value !== null ||
      hasAttributeControl.called !== true ||
      hasAttributeControl.value !== false ||
      readCaptured(replayControl, nativeIsConnected, 'isConnected') !== false ||
      readCaptured(urlControl, nativeUrlHref, 'href') !==
        'https://kovo.invalid/control?ready=1#ok' ||
      readCaptured(urlControl, nativeUrlOrigin, 'origin') !== 'https://kovo.invalid' ||
      readCaptured(urlControl, nativeUrlPathname, 'pathname') !== '/control' ||
      readCaptured(urlControl, nativeUrlSearch, 'search') !== '?ready=1' ||
      readCaptured(urlControl, nativeUrlHash, 'hash') !== '#ok' ||
      typeof readCaptured(browserLocation, nativeLocationHref, 'href') !== 'string' ||
      typeof readCaptured(browserLocation, nativeLocationOrigin, 'origin') !== 'string' ||
      typeof readCaptured(browserLocation, nativeLocationPathname, 'pathname') !== 'string' ||
      typeof readCaptured(browserLocation, nativeLocationSearch, 'search') !== 'string'
    ) {
      throw new TypeError('Kovo bootstrap event controls are unavailable.');
    }
    rap(nativePreventDefault, eventControl, []);
    if (readCaptured(eventControl, nativeEventDefaultPrevented, 'defaultPrevented') !== true) {
      throw new TypeError('Kovo bootstrap event controls are unavailable.');
    }
    const replayType = 'kovo-security-control:bootstrap-replay';
    let replayCalls = 0;
    const replayListener = () => {
      replayCalls += 1;
    };
    rap(nativeAddEventListener, replayControl, [replayType, replayListener]);
    try {
      if (rap(nativeDispatchEvent, replayControl, [new NativeEvent(replayType)]) !== true) {
        throw new TypeError('Kovo bootstrap replay dispatch control is invalid.');
      }
    } finally {
      rap(nativeRemoveEventListener, replayControl, [replayType, replayListener]);
    }
    if (
      replayCalls !== 1 ||
      rap(nativeDispatchEvent, replayControl, [new NativeEvent(replayType)]) !== true ||
      replayCalls !== 1
    ) {
      throw new TypeError('Kovo bootstrap replay controls are unavailable.');
    }
    try {
      rap(nativeDispatchEvent, {}, [new NativeEvent(replayType)]);
    } catch {
      replayControlsReady = true;
    }
  } catch {}
  if (!replayControlsReady) {
    throw new TypeError('Kovo bootstrap replay controls are unavailable.');
  }
  const submitForm = (form) => {
    try {
      rap(nativeSubmit, form, []);
      return true;
    } catch {}
    const ownSubmit = gopd(form, 'submit');
    if (!ownSubmit || !('value' in ownSubmit) || typeof ownSubmit.value !== 'function') return false;
    try {
      rap(ownSubmit.value, form, []);
      return true;
    } catch {
      return false;
    }
  };
  const callEventTargetMethod = (target, nativeMethod, property, args) => {
    return callCaptured(target, nativeMethod, property, args).called;
  };
  const dispatchEvent = (target, event) =>
    callEventTargetMethod(target, nativeDispatchEvent, 'dispatchEvent', [event]);
  const closestElement = (target, selector) => {
    const result = callCaptured(target, nativeClosest, 'closest', [selector]);
    return result.called ? result.value : undefined;
  };
  const readAttribute = (element, name) => {
    const result = callCaptured(element, nativeGetAttribute, 'getAttribute', [name]);
    if (result.called) return typeof result.value === 'string' ? result.value : null;
    const value = ownValue(element, name);
    return typeof value === 'string' ? value : null;
  };
  const hasAttribute = (element, name) => {
    const result = callCaptured(element, nativeHasAttribute, 'hasAttribute', [name]);
    return result.called && result.value === true;
  };
  const isConnected = (target) => readCaptured(target, nativeIsConnected, 'isConnected') === true;
  const snapshotEvent = (event) => ({
    altKey: readCaptured(event, nativeMouseAltKey, 'altKey') === true,
    button: readCaptured(event, nativeMouseButton, 'button'),
    ctrlKey: readCaptured(event, nativeMouseCtrlKey, 'ctrlKey') === true,
    defaultPrevented:
      readCaptured(event, nativeEventDefaultPrevented, 'defaultPrevented') === true,
    metaKey: readCaptured(event, nativeMouseMetaKey, 'metaKey') === true,
    shiftKey: readCaptured(event, nativeMouseShiftKey, 'shiftKey') === true,
    submitter: readCaptured(event, nativeSubmitter, 'submitter'),
    target: readCaptured(event, nativeEventTarget, 'target'),
    type: readCaptured(event, nativeEventType, 'type'),
  });
  const preventEventDefault = (event) => {
    const result = callCaptured(event, nativePreventDefault, 'preventDefault', []);
    return (
      result.called &&
      readCaptured(event, nativeEventDefaultPrevented, 'defaultPrevented') === true
    );
  };
  const currentLocation = () => {
    const href = readCaptured(browserLocation, nativeLocationHref, 'href');
    const origin = readCaptured(browserLocation, nativeLocationOrigin, 'origin');
    const pathname = readCaptured(browserLocation, nativeLocationPathname, 'pathname');
    const search = readCaptured(browserLocation, nativeLocationSearch, 'search');
    return typeof href === 'string' &&
      typeof origin === 'string' &&
      typeof pathname === 'string' &&
      typeof search === 'string'
      ? { href, origin, pathname, search }
      : undefined;
  };
  const parseUrl = (input, base) => {
    try {
      const value = new NativeURL(input, base);
      const href = readCaptured(value, nativeUrlHref, 'href');
      const origin = readCaptured(value, nativeUrlOrigin, 'origin');
      const pathname = readCaptured(value, nativeUrlPathname, 'pathname');
      const search = readCaptured(value, nativeUrlSearch, 'search');
      const hash = readCaptured(value, nativeUrlHash, 'hash');
      return typeof href === 'string' &&
        typeof origin === 'string' &&
        typeof pathname === 'string' &&
        typeof search === 'string' &&
        typeof hash === 'string'
        ? { hash, href, origin, pathname, search }
        : undefined;
    } catch {
      return undefined;
    }
  };
  const events = ['click', 'submit'];
  const queued = [];
  const streamQueue = [];
  let loading;
  const previousApply = ownValue(globalThis, '__kovo_a');
  const queueStream = (body) => {
    streamQueue[streamQueue.length] = body;
  };
  odp(globalThis, '__kovo_a', {
    configurable: true,
    enumerable: true,
    value: queueStream,
    writable: true,
  });
  if (ownValue(globalThis, '__kovo_a') !== queueStream) {
    throw new TypeError('Kovo bootstrap stream queue controls are unavailable.');
  }
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
  const enhancedAnchor = (facts) => {
    if (
      facts.defaultPrevented ||
      facts.button ||
      facts.metaKey ||
      facts.ctrlKey ||
      facts.shiftKey ||
      facts.altKey
    ) {
      return;
    }
    const target = facts.target;
    const anchor = closestElement(target, 'a[href]');
    if (
      !anchor ||
      closestElement(target, '[on\\:click]') ||
      readAttribute(anchor, 'target') ||
      hasAttribute(anchor, 'download')
    ) {
      return;
    }
    const location = currentLocation();
    const href = readAttribute(anchor, 'href');
    if (!location || !href) return;
    const url = parseUrl(href, location.href);
    if (!url || url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
    return { href: url.href, target, type: 'click' };
  };
  const enhancedSubmit = (facts) => {
    const form = closestElement(
      facts.target,
      'form[enhance],form[data-enhance],form[data-mutation]',
    );
    return form ? { submitter: facts.submitter, target: form, type: 'submit' } : undefined;
  };
  const authoredClick = (facts) => {
    if (
      facts.defaultPrevented ||
      facts.button ||
      facts.metaKey ||
      facts.ctrlKey ||
      facts.shiftKey ||
      facts.altKey
    ) {
      return;
    }
    const target = facts.target;
    return closestElement(target, '[on\\:click]') ? { target, type: 'click' } : undefined;
  };
  const replay = (item) => {
    if (!isConnected(item.target)) return;
    if (item.type === 'submit') {
      let event;
      if (typeof NativeSubmitEvent === 'function') {
        try {
          event = new NativeSubmitEvent('submit', {
            bubbles: true,
            cancelable: true,
            submitter: item.submitter,
          });
        } catch {}
      }
      if (!event) {
        event = new NativeEvent('submit', {
          bubbles: true,
          cancelable: true,
        });
      }
      dispatchEvent(item.target, event);
      return;
    }
    dispatchEvent(
      item.target,
      new NativeMouseEvent('click', { bubbles: true, cancelable: true }),
    );
  };
  const fallback = (item) => {
    if (!isConnected(item.target)) return;
    if (item.type === 'submit') {
      if (!submitForm(item.target)) replay(item);
      return;
    }
    if (item.href) rap(nativeLocationAssign, browserLocation, [item.href]);
    else replay(item);
  };
  const cleanup = () => {
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      callEventTargetMethod(globalThis, nativeRemoveEventListener, 'removeEventListener', [
        event,
        capture,
        { capture: true },
      ]);
    }
  };
  const take = (queue) => {
    const length = queue.length;
    const values = [];
    for (let index = 0; index < length; index += 1) values[index] = queue[index];
    queue.length = 0;
    return values;
  };
  const load = () => {
    if (loading) return loading;
    loading = (async () => {
      try {
        const mod = await runtimeImport(runtimeUrl);
        cleanup();
        const installDeferredRuntime = ownValue(mod, 'installKovoDeferredRuntime');
        if (typeof installDeferredRuntime !== 'function') {
          throw new TypeError('Kovo deferred runtime installer export is unavailable.');
        }
        rap(installDeferredRuntime, undefined, []);
        const apply = ownValue(globalThis, '__kovo_a');
        if (typeof apply === 'function' && apply !== previousApply) {
          const bodies = take(streamQueue);
          for (let index = 0; index < bodies.length; index += 1) {
            rap(apply, undefined, [bodies[index]]);
          }
        }
        const items = take(queued);
        for (let index = 0; index < items.length; index += 1) replay(items[index]);
      } catch {
        cleanup();
        const items = take(queued);
        for (let index = 0; index < items.length; index += 1) fallback(items[index]);
      }
    })();
    return loading;
  };
  const capture = (event) => {
    const facts = snapshotEvent(event);
    const item =
      facts.type === 'submit'
        ? enhancedSubmit(facts)
        : facts.type === 'click'
          ? authoredClick(facts) || enhancedAnchor(facts)
          : undefined;
    if (!item) return;
    if (!preventEventDefault(event)) return;
    queued[queued.length] = item;
    void load();
  };
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (
      !callEventTargetMethod(globalThis, nativeAddEventListener, 'addEventListener', [
        event,
        capture,
        { capture: true },
      ])
    ) {
      throw new TypeError('Kovo bootstrap replay listener enrollment failed.');
    }
  }
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

function readInlineTrustedTypesReadableSource(): string {
  return readInlineHelperReadableSource(inlineHelperSpecs.trustedTypes);
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

  return replaceInlineLoaderIdentifierTokens(
    transpiled.replace(/^"use strict";\s*/, '').trim(),
    new Map([
      ['securityArrayAppend', 'bns.appendDenseSecurityValue'],
      ['securityGetOwnPropertyDescriptor', 'bns.getOwnSecurityPropertyDescriptor'],
    ]),
  );
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
  const sinkRoutes = countSubstring(applySource, 'createHTML(renderedFragmentHtmlContent(');
  if (sinkRoutes !== 2) {
    throw new Error(
      `Inline Kovo loader Trusted Types routing must wrap both ${mode} response-apply raw-HTML inputs; found ${sinkRoutes}.`,
    );
  }

  const capturedSetter =
    mode === 'readable'
      ? installerSource.includes('const elementInnerHtmlSetter =')
      : installerSource.includes('const elementInnerHtmlSetter=');
  if (!capturedSetter) {
    throw new Error(
      `Inline Kovo loader ${mode} Trusted Types routing is missing the captured innerHTML setter.`,
    );
  }

  const requiredTokens = [
    ['function createKovoTrustedTypesSecurityControls('],
    ["'kovo'"],
    ['exactTrustedHTML'],
    ['policyCreateHTML'],
    ['tts.createHTML(html)'],
  ];
  for (const tokens of requiredTokens) {
    if (!tokens.some((token) => installerSource.includes(token))) {
      throw new Error(
        `Inline Kovo loader ${mode} Trusted Types routing is missing ${tokens.join(' or ')}.`,
      );
    }
  }

  if (installerSource.includes('__kovo_tt') || applySource.includes('__kovo_tt')) {
    throw new Error(
      `Inline Kovo loader ${mode} Trusted Types routing must not trust a public realm policy cache.`,
    );
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
      if (
        name !== 'securityArrayAppend' &&
        name !== 'securityGetOwnPropertyDescriptor' &&
        unsupportedTopLevelBindings.has(name) &&
        !declarations.has(name) &&
        !local
      ) {
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

export async function emitInlineKovoLoaderModule(
  options: EmitInlineKovoLoaderModuleOptions = {},
): Promise<EmitInlineKovoLoaderModuleResult> {
  const targetPath = resolve(options.targetPath ?? inlineKovoLoaderModulePath);
  const outputRoot = dirname(targetPath);
  const targetName = basename(targetPath);
  const source =
    options.source === undefined
      ? buildInlineKovoLoaderModuleSource()
      : buildInlineKovoLoaderModuleSource(options.source);
  const current = await readInlineLoaderOutputFile(outputRoot, targetName);
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

  if (changed) {
    await writeInlineLoaderOutputFile(outputRoot, targetName, source);
  }

  return { changed, source, targetPath };
}

async function readInlineLoaderOutputFile(
  outputRoot: string,
  targetName: string,
): Promise<string | undefined> {
  const pinnedRoot = await pinInlineLoaderOutputRoot(outputRoot);
  await verifyInlineLoaderOutputRoot(pinnedRoot);
  const target = join(pinnedRoot.canonicalPath, targetName);
  try {
    const status = await lstat(target);
    if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1) return undefined;
    return NativeBuffer.from(await readFile(target)).toString('utf8');
  } catch (error) {
    if (isMissingInlineLoaderOutput(error)) return undefined;
    throw error;
  }
}

async function writeInlineLoaderOutputFile(
  outputRoot: string,
  targetName: string,
  source: string,
): Promise<void> {
  const pinnedRoot = await pinInlineLoaderOutputRoot(outputRoot);
  await verifyInlineLoaderOutputRoot(pinnedRoot);
  const temporary = join(pinnedRoot.canonicalPath, `.${targetName}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, source, { flag: 'wx' });
    await verifyInlineLoaderOutputRoot(pinnedRoot);
    await rename(temporary, join(pinnedRoot.canonicalPath, targetName));
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!isMissingInlineLoaderOutput(error)) throw error;
    });
  }
}

interface PinnedInlineLoaderOutputRoot {
  canonicalDev: number;
  canonicalIno: number;
  canonicalPath: string;
  lexicalDev: number;
  lexicalIno: number;
  lexicalPath: string;
}

async function pinInlineLoaderOutputRoot(
  outputRoot: string,
): Promise<PinnedInlineLoaderOutputRoot> {
  const lexicalPath = resolve(outputRoot);
  const lexicalStatus = await lstat(lexicalPath);
  if (lexicalStatus.isSymbolicLink() || !lexicalStatus.isDirectory()) {
    throw new Error(
      `Inline-loader output root '${lexicalPath}' must be a non-symbolic-link directory.`,
    );
  }
  const canonicalPath = await realpath(lexicalPath);
  const canonicalStatus = await stat(canonicalPath);
  if (!canonicalStatus.isDirectory()) {
    throw new Error(`Inline-loader output root '${lexicalPath}' does not resolve to a directory.`);
  }
  return {
    canonicalDev: canonicalStatus.dev,
    canonicalIno: canonicalStatus.ino,
    canonicalPath,
    lexicalDev: lexicalStatus.dev,
    lexicalIno: lexicalStatus.ino,
    lexicalPath,
  };
}

async function verifyInlineLoaderOutputRoot(
  pinnedRoot: PinnedInlineLoaderOutputRoot,
): Promise<void> {
  const lexicalStatus = await lstat(pinnedRoot.lexicalPath);
  if (
    lexicalStatus.isSymbolicLink() ||
    !lexicalStatus.isDirectory() ||
    lexicalStatus.dev !== pinnedRoot.lexicalDev ||
    lexicalStatus.ino !== pinnedRoot.lexicalIno
  ) {
    throw new Error(`Inline-loader output root '${pinnedRoot.lexicalPath}' identity changed.`);
  }
  const canonicalPath = await realpath(pinnedRoot.lexicalPath);
  const canonicalStatus = await stat(canonicalPath);
  if (
    canonicalPath !== pinnedRoot.canonicalPath ||
    !canonicalStatus.isDirectory() ||
    canonicalStatus.dev !== pinnedRoot.canonicalDev ||
    canonicalStatus.ino !== pinnedRoot.canonicalIno
  ) {
    throw new Error(`Inline-loader output root '${pinnedRoot.lexicalPath}' identity changed.`);
  }
}

function isMissingInlineLoaderOutput(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
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
  const result = await emitInlineKovoLoaderModule({ check: process.argv.includes('--check') });

  if (!process.argv.includes('--check')) {
    console.log(
      `${result.changed ? 'Wrote' : 'Unchanged'} ${result.targetPath} from inline-loader-build.ts.`,
    );
  }
}
