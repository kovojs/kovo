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
const wireResponseScannerSourcePath = fileURLToPath(
  new URL('./wire-response-scanner.ts', import.meta.url),
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
    sourcePaths: [wireHtmlSourcePath, wireResponseScannerSourcePath],
  },
} as const;

type InlineHelperSpec = (typeof inlineHelperSpecs)[keyof typeof inlineHelperSpecs];

export const inlineKovoLoaderGzipByteBudget = 8192;

export const inlineWireParserReadableSource = readInlineWireParserReadableSource();
export const inlineResponseApplyReadableSource = readInlineResponseApplyReadableSource();
export const inlineFragmentTargetEscapeReadableSource =
  readInlineFragmentTargetEscapeReadableSource();
export const inlineDelegatedEvents = readModularDefaultDelegatedEvents();

export const inlineKovoLoaderInstallerReadableSource =
  buildInlineKovoLoaderInstallerReadableSource();
export const inlineKovoLoaderStubInstallerReadableSource =
  buildInlineKovoLoaderStubInstallerReadableSource();

export function buildInlineKovoLoaderInstallerReadableSource(
  wireParserReadableSource = inlineWireParserReadableSource,
  responseApplyReadableSource = inlineResponseApplyReadableSource,
  delegatedEvents: readonly string[] = inlineDelegatedEvents,
  fragmentTargetEscapeReadableSource = inlineFragmentTargetEscapeReadableSource,
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
  let ic = 0;
  const ci = () =>
    crypto.randomUUID?.() ||
    'i' + Date.now().toString(36) + (ic += 1).toString(36);
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
  const sf = (href) => {
    const x = globalThis.scrollX || globalThis.pageXOffset || 0;
    const y = globalThis.scrollY || globalThis.pageYOffset || 0;
    if (href) sc[href] = [x, y];
  };
  const hid = (hash) => {
    const value = hash.slice(1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  const ht = (hash) => {
    const raw = hash.slice(1);
    const decoded = hid(hash);
    return (
      doc.getElementById(decoded) ??
      doc.getElementById(raw) ??
      doc.getElementsByName?.(decoded)?.[0] ??
      doc.getElementsByName?.(raw)?.[0]
    );
  };
  const so = () => {
    let offset = 0;
    for (const el of qa(doc, 'body *')) {
      const style = globalThis.getComputedStyle?.(el);
      if (!style || (style.position !== 'fixed' && style.position !== 'sticky')) continue;
      const top = parseFloat(style.top || '0') || 0;
      const rect = el.getBoundingClientRect?.();
      if (top <= 0 && rect && rect.top <= 1 && rect.bottom > offset) offset = rect.bottom;
    }
    return offset;
  };
  const hscl = (hash) => {
    const target = ht(hash);
    if (!target) return;
    const offset = so();
    const rect = target.getBoundingClientRect?.();
    if (offset && rect) {
      globalThis.scrollTo?.(
        globalThis.scrollX || globalThis.pageXOffset || 0,
        (globalThis.scrollY || globalThis.pageYOffset || 0) + rect.top - offset,
      );
      return;
    }
    target.scrollIntoView?.();
  };
  const vp = (val, path) =>
    path.split('.').reduce((cur, seg) => {
      const key = seg.endsWith('?') ? seg.slice(0, -1) : seg;
      return typeof cur === 'object' && cur !== null ? cur[key] : undefined;
    }, val);
  const fb = (val) =>
    val == null ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
  const sh = (el, host) =>
    el === host || !el.closest || el.closest('[kovo-state]') === host;
  const ba = (el) =>
    [...(el.attributes || [])].filter(
      (attr) => attr.name.startsWith('data-bind:') && attr.value,
    );
  const wa = (el, name, val) => {
    if ((name === 'checked' || name === 'indeterminate') && val === false) val = null;
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
    if (val == null) el.removeAttribute?.(name);
    else el.setAttribute?.(name, fb(val));
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
    if (name === 'checked' && el.checked !== undefined) el.checked = val != null;
    if (name === 'indeterminate' && el.indeterminate !== undefined) {
      el.indeterminate = val != null;
    }
  };
  const ws = (el, path, bt, state, root = 'state') => {
    if (!path?.startsWith(root + '.')) return;
    const val = vp(state, path.slice(root.length + 1));
    if (bt) {
      wa(el, bt, val);
    } else if (el.value !== undefined) {
      el.value = fb(val);
    } else {
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
    } else if (el.value !== undefined) {
      el.value = fb(val);
    } else {
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
      if (!hsaf(target) || !hsc(component)) continue;
      if (!target || seen.has(target)) continue;
      seen.add(target);
      targets.push(target + '#' + component + ':' + JSON.stringify(liveProps(el)));
    }
    return targets;
  };
  // SPEC.md §9.1: inline fragment apply uses the same escaped target lookup
  // precedence as the modular runtime and Kovo-Targets collection.
  const ft = (target) => {
    try {
      const selectorTarget = sq(target);
      return (
        doc.querySelector('[kovo-fragment-target="' + selectorTarget + '"]') ??
        doc.getElementById(target) ??
        doc.querySelector('[id="' + selectorTarget + '"]') ??
        doc.querySelector('[kovo-c="' + selectorTarget + '"]') ??
        doc.querySelector('kovo-defer[target="' + selectorTarget + '"]')
      );
    } catch {
      return;
    }
  };
  const hs = (el) => ((el = el.closest('[kovo-c]') || el).a ||= new AbortController()).signal;
  const kb = (root = doc) =>
    root.querySelector('meta[name="kovo-build"]')?.getAttribute('content') || '';
  const ns = (root) => [...root.querySelectorAll('[kovo-nav-segment]')];
  const nk = (el) =>
    [
      el.getAttribute('kovo-nav-segment'),
      el.getAttribute('kovo-nav-kind'),
      el.getAttribute('kovo-nav-name'),
      el.getAttribute('kovo-nav-queries') || '',
      el.getAttribute('kovo-nav-components') || '',
    ].join('|');
  const nc = (el) => {
    const copy = el.cloneNode(true);
    for (const child of qa(copy, '[kovo-nav-segment]')) child.remove();
    return copy.outerHTML;
  };
  const di = (root) => {
    const ids = new Set();
    const add = (el) => {
      const id = el.getAttribute?.('id') || el.id;
      if (id) ids.add(id);
    };
    add(root);
    for (const el of qa(root, '[id]')) add(el);
    return ids;
  };
  const pi = (segments, end) => {
    const ids = new Set();
    for (let i = 0; i < end; i += 1) {
      const copy = segments[i].cloneNode(true);
      for (const child of qa(copy, '[kovo-nav-segment]')) child.remove();
      for (const id of di(copy)) ids.add(id);
    }
    return ids;
  };
  const dc = (preserved, next) => {
    for (const id of di(next)) if (preserved.has(id)) return true;
    return false;
  };
  const rbd = (nextBody) => {
    if (doc.documentElement?.replaceChild && doc.body) {
      doc.documentElement.replaceChild(nextBody, doc.body);
    } else {
      doc.body.replaceWith(nextBody);
    }
    return nextBody;
  };
  const ng = (href) => {
    if (location.assign) location.assign(href);
    else location.href = href;
  };
  const an = async (href, pop = false) => {
    const navId = (ni += 1);
    try {
      const requestedUrl = new URL(href, location.href);
      const response = await fetch(href, {
        headers: { Accept: ${JSON.stringify(enhancedNavigationDocumentAcceptHeader)} },
      });
      if (navId !== ni) return;
      const finalUrl = new URL(response.url || href, location.href);
      if (!finalUrl.hash && requestedUrl.hash) finalUrl.hash = requestedUrl.hash;
      const contentType = response.headers?.get('content-type') || '';
      if (finalUrl.origin !== location.origin || !contentType.toLowerCase().includes('text/html')) {
        throw Error();
      }
      const nextDoc = new DOMParser().parseFromString(await response.text(), 'text/html');
      if (navId !== ni) return;
      const nextBody = nextDoc?.body;
      if (!nextBody || kb() !== kb(nextDoc)) throw Error();
      const currentSegments = ns(doc.body);
      const nextSegments = ns(nextBody);
      if (!nextSegments.length) throw Error();
      let triggerRoot;

      let index = 0;
      for (
        ;
        index < currentSegments.length &&
        index < nextSegments.length &&
        nk(currentSegments[index]) === nk(nextSegments[index]) &&
        nc(currentSegments[index]) === nc(nextSegments[index]);
        index += 1
      );

      if (!currentSegments.length || index === 0) {
        for (const el of qa(doc.body, '[kovo-c]')) el.a?.abort();
        triggerRoot = rbd(nextBody);
      } else if (index < currentSegments.length && index < nextSegments.length) {
        if (dc(pi(currentSegments, index), nextSegments[index])) throw Error();
        for (const el of qa(currentSegments[index], '[kovo-c]')) el.a?.abort();
        m(currentSegments[index], nextSegments[index]);
        triggerRoot = currentSegments[index];
      } else if (currentSegments.length !== nextSegments.length) {
        throw Error();
      }

      doc.head.innerHTML = nextDoc.head.innerHTML;
      ps();
      xd(doc.documentElement, nextDoc.documentElement);
      const body = doc.body || triggerRoot;
      if (!body) throw Error();
      xa(body, nextBody);
      if (!pop) globalThis.history?.pushState?.({}, '', finalUrl.href);
      const focusTarget = doc.querySelector('main,h1') ?? doc.querySelector('[kovo-nav-segment]');
      focusTarget?.setAttribute?.('tabindex', '-1');
      focusTarget?.focus?.({ preventScroll: true });
      const saved = sc[finalUrl.href];
      if (pop && saved) globalThis.scrollTo?.(saved[0], saved[1]);
      else if (finalUrl.hash) {
        hscl(finalUrl.hash);
        setTimeout(() => {
          if (navId === ni) hscl(finalUrl.hash);
        });
      }
      else globalThis.scrollTo?.(0, 0);
      if (triggerRoot) setTimeout(() => tr(triggerRoot));
      cu = finalUrl.href;
      dispatchEvent(new CustomEvent('kovo:navigate', { detail: { url: finalUrl.href } }));
    } catch {
      if (navId === ni) ng(href);
    }
  };
  const inav = (event) => {
    if (
      event.defaultPrevented ||
      event.button ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return false;
    }
    const anchor = event.target?.closest?.('a[href]');
    if (
      !anchor ||
      event.target?.closest?.('[on\\:click]') ||
      anchor.target ||
      anchor.hasAttribute?.('download')
    ) {
      return false;
    }
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin) return false;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) {
      return false;
    }
    event.preventDefault();
    sf(location.href);
    void an(url.href);
    return true;
  };
  const sc = {};
  let cu = location.href;
  let ni = 0;
  if (globalThis.history?.scrollRestoration !== undefined) {
    globalThis.history.scrollRestoration = 'manual';
  }
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
  const ab = (body) => {
    const chunks = readInlineMutationResponseBodyChunks(body);
    dq('kovo:query', {
      detail: {
        ['quer' + 'ies']: chunks.queries,
      },
    });
    for (const x of chunks.fragments) {
      if (x.mode === 'append') continue;
      const e = ft(x.target);
      if (e) for (const y of qa(e, '[kovo-c]')) {
        if (x.html.includes(y.getAttribute('kovo-c'))) continue;
        y.a?.abort();
      }
    }
    applyInlineMutationResponseChunks(chunks, { findFragmentTarget: ft });
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
    for (const x of texts || []) {
      const el = sft(x.target);
      if (!el) continue;
      const text = unescapeHtml(x.text);
      const source = x.mode === 'checkpoint' ? text : (st[x.target] ?? el.textContent ?? '') + text;
      st[x.target] = source;
      se[x.target] = el;
      el.textContent = source;
      el.setAttribute?.('data-stream-state', 'streaming');
      void sr(el, source).catch(() => {});
    }
  };
  const sfail = () => {
    for (const key in se) se[key].setAttribute?.('data-stream-state', 'error');
  };
  const cp = (body) => {
    const chunks = readMutationResponseElementChunks(body);
    const dones = readElementChunks(body, 'kovo-done');
    let end = 0;
    for (const group of [chunks.queries, chunks.fragments, chunks.texts, dones]) {
      for (const x of group) if (x.end > end) end = x.end;
    }
    if (!end) return body;
    ab(body.slice(0, end));
    for (const x of dones) {
      const reason = readAttribute(x.attrs, 'reason');
      if (reason && reason !== 'complete') sfail();
    }
    return body.slice(end);
  };
  const asr = async (body) => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    try {
      while (true) {
        const read = await reader.read();
        if (read.done) break;
        pending = cp(pending + decoder.decode(read.value, { stream: true }));
      }
      pending += decoder.decode();
      if (pending) ab(pending);
    } catch (error) {
      sfail();
      throw error;
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
  const sef = (event, form) => {
    event.preventDefault();
    const streaming = form.getAttribute?.('data-mutation-stream') !== null;
    const body = new FormData(form, event.submitter);
    const formIdem = body.get?.('Kovo-Idem');
    const idem = typeof formIdem === 'string' && formIdem !== '' ? formIdem : ci();
    fetch(form.action, {
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
      method: (form.method || 'post').toUpperCase(),
    })
      .then((response) => {
        const reauth = response.headers?.get('Kovo-Reauth') ?? response.headers?.get('kovo-reauth');
        if (response.status === 401 && reauth) {
          location.assign?.(reauth);
          return;
        }
        return streaming && response.body
          ? asr(response.body)
          : response.text().then(ab);
      })
      .catch(() => fsb(form));
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
    root.querySelectorAll('[on\\:load]').forEach((el) => to(el, 'load') && trigger('load', el));
    root
      .querySelectorAll('[on\\:idle]')
      .forEach((el) =>
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
      root.querySelectorAll('[on\\:visible]').forEach((el) => to(el, 'visible') && observer.observe(el));
    }
  };
  const ps = () => {
    const promote = () => {
      for (const el of qa(doc, 'link[data-kovo-deferred-style]')) {
        const href = el.getAttribute?.('href');
        if (!href) continue;
        const existing = qa(doc, 'link[rel="stylesheet"][href]').some(
          (link) => link !== el && link.getAttribute?.('href') === href,
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
  addEventListener('popstate', () => {
    sf(cu);
    void an(location.href, true);
  });
  // SPEC.md §4.7: declared triggers are legible in body markup, while the default
  // document emits the loader in <head>. Defer the scan one task so the parser can
  // continue into the body; event delegation above is installed immediately.
  ps();
  setTimeout(() => tr(doc));
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
          (link) => link !== el && link.getAttribute?.('href') === href,
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
    const item = event.type === 'submit' ? enhancedSubmit(event) : enhancedAnchor(event);
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
  assertInlineKovoLoaderGzipBudget(installerSource, 'Generated inline Kovo loader module');
  assertInlineKovoLoaderBootstrapGzipBudget(
    stubInstallerSource,
    'Generated inline Kovo loader bootstrap',
  );

  const moduleSource = `${[
    '// @ts-nocheck',
    '// Generated from the SPEC.md §4.4 readable inline bootstrap by inline-loader-build.ts.',
    "import type { ImportHandlerModule } from './handlers.js';",
    '',
    '// SPEC.md §4.4 keeps the always-loaded loader under an 8KB gzip budget; this',
    '// literal is the pre-minified bootstrap shipped in document shells.',
    '/** Runtime API used by Kovo applications and generated runtime integration. */',
    `export const inlineKovoLoaderInstallerSource = ${inlineJavaScriptTemplateLiteral(
      installerSource,
    )};`,
    `export const inlineKovoLoaderBootstrapInstallerSource = ${inlineJavaScriptTemplateLiteral(
      stubInstallerSource,
    )};`,
    "export const kovoDeferredRuntimeModulePath = '/c/kovo-runtime.client.js';",
    `export const kovoDeferredRuntimeModuleVersion = '${runtimeModuleVersion}';`,
    `export const kovoDeferredRuntimeModuleSource = ${inlineJavaScriptTemplateLiteral(
      runtimeModuleSource,
    )};`,
    '',
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
    '  inlineKovoLoaderBootstrapInstaller(runtimeUrl, runtimeImport ?? ((url) => import(/* @vite-ignore */ url)));',
    '}',
    '',
    '/** Runtime API used by Kovo applications and generated runtime integration. */',
    'export function createInlineKovoLoaderSource(',
    '  runtimeModuleExpression = JSON.stringify(kovoDeferredRuntimeModulePath),',
    '  runtimeImportExpression?: string,',
    '): string {',
    "  const importExpression = (runtimeImportExpression ?? (runtimeModuleExpression === JSON.stringify(kovoDeferredRuntimeModulePath) ? '(url)=>import(url)' : runtimeModuleExpression)).trim();",
    '  const runtimeExpression = (runtimeImportExpression === undefined',
    '    ? JSON.stringify(kovoDeferredRuntimeModulePath)',
    '    : runtimeModuleExpression).trim();',
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
  ].join('\n')}\n`;
  assertInlineKovoLoaderModuleArtifactParity(moduleSource, 'Generated inline Kovo loader module');

  return moduleSource;
}

function buildKovoDeferredRuntimeModuleSource(installerSource: string): string {
  return [
    `const install=(${installerSource});`,
    'export function installKovoDeferredRuntime(importModule=(url)=>import(url)){install(importModule);}',
    '',
  ].join('\n');
}

export function assertInlineKovoLoaderGzipBudget(
  installerSource: string,
  label = 'Inline Kovo loader',
): void {
  const bytes = gzipSync(createFullInlineKovoLoaderBootstrapSource(installerSource)).byteLength;
  if (bytes <= inlineKovoLoaderGzipByteBudget) return;

  throw new Error(
    `${label} exceeds SPEC.md §4.4 gzip budget: ${bytes} bytes > ${inlineKovoLoaderGzipByteBudget} bytes.`,
  );
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
  // SPEC.md §4.4: the generated bootstrap has a hard 8KB gzip ceiling. Keep
  // source modules readable, then compact only closure-local helper names before
  // the parse-checked minifier runs.
  const replacements = new Map([
    ['readMutationResponseBodyCore', 'rb'],
    ['readInlineMutationResponseBodyChunks', 'ri'],
    ['readMutationResponseElementChunks', 'rc'],
    ['readFragmentChunksFromElements', 'rfs'],
    ['readFragmentElementChunk', 'rf'],
    ['applyInlineMutationResponseChunks', 'ai'],
    ['findFragmentTarget', 'ff'],
    ['readElementChunks', 're'],
    ['matchingElementEnd', 'me'],
    ['escapeRegExp', 'er'],
    ['readAttribute', 'ra'],
    ['unescapeHtml', 'uh'],
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
    // guard within the SPEC.md §4.4 8KB ceiling.
    ['dispatch', 'dp'],
    ['targetIdentity', 't'],
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
  assertInlineKovoLoaderGzipBudget(installerLiteralSource, label);
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

function createFullInlineKovoLoaderBootstrapSource(
  installerSource: string,
  importModuleExpression = '(url)=>import(url)',
): string {
  return `(${installerSource})(${importModuleExpression});`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = emitInlineKovoLoaderModule({ check: process.argv.includes('--check') });

  if (!process.argv.includes('--check')) {
    console.log(
      `${result.changed ? 'Wrote' : 'Unchanged'} ${result.targetPath} from inline-loader-build.ts.`,
    );
  }
}
