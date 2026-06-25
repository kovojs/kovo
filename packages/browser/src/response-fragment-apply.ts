import type { FragmentChunk } from './wire-response-scanner.js';

// SF-WIRE (secure-framework Tier 3, Trusted Types — DEFERRED): the `p` and `d` helpers
// below (their `template.innerHTML = ...` raw-HTML write sinks) are EXTRACTED VERBATIM into the
// always-on inline loader by `inline-loader-build.ts`
// (the `responseApply` spec; a byte-parity test pins the generated `inline-loader.ts`), and
// that extractor forbids referencing any top-level binding. So unlike the module-side sinks
// in `morph.ts`/`query-bindings.ts` — which DO route through `kovoCreateHTML` (trusted-types.ts)
// and are verified non-breaking by the browser suite — these two sinks CANNOT call
// `kovoCreateHTML`. Routing them needs the `kovo` Trusted Types policy embedded INSIDE the
// extracted closures (and minified under the 8.75KB §4.4 budget) via `inline-loader-build.ts`.
// That Trusted Types routing is separate from these sink backstops and is the load-bearing reason
// the strict CSP's `require-trusted-types-for 'script'` directive (server `csp.ts` `trustedTypes`)
// stays OPT-IN and is NEVER default-on: enabling it before this always-on loader is routed would BRICK
// Kovo's own hydration on Chromium. CSP (Task 1) is the cross-browser floor and IS default-on;
// Trusted Types is Chromium-only DiD and ships opt-in until this loader path is wired.

export interface ResponseFragmentApplyOptions<Target> {
  appendFragment(target: Target, html: string): void;
  findFragmentTarget(target: string): Target | null | undefined;
  replaceFragment(target: Target, html: string): void;
}

export interface HtmlResponseFragmentApplyTarget extends Element {}

export function applyResponseFragment<Target>(
  fragment: FragmentChunk,
  options: ResponseFragmentApplyOptions<Target>,
): boolean {
  const element = options.findFragmentTarget(fragment.target);
  if (!element) return false;

  if (fragment.mode === 'append') {
    options.appendFragment(element, fragment.html);
  } else {
    options.replaceFragment(element, fragment.html);
  }
  return true;
}

export function applyResponseFragments<Target>(
  fragments: readonly FragmentChunk[],
  options: ResponseFragmentApplyOptions<Target>,
): string[] {
  // SPEC.md §9.1: decoded kovo-fragment chunks report the same applied target
  // list whether the caller is modular DOM morph or the generated inline loader.
  const applied: string[] = [];

  for (const fragment of fragments) {
    if (applyResponseFragment(fragment, options)) applied.push(fragment.target);
  }

  return applied;
}

export function applyHtmlResponseFragments(
  fragments: readonly FragmentChunk[],
  findFragmentTarget: (target: string) => HtmlResponseFragmentApplyTarget | null | undefined,
): string[] {
  return p(fragments, findFragmentTarget);
}

export function p(
  fs: readonly FragmentChunk[],
  f: (target: string) => HtmlResponseFragmentApplyTarget | null | undefined,
): string[] {
  // SPEC.md §4.4/§9.1: generated inline apply and modular decoded fragment
  // tests share the DOM HTML adapter instead of carrying an inline-only clone.
  const a: string[] = [];

  for (const x of fs) {
    const e = f(x.target);
    if (!e) continue;

    if (x.mode === 'append') {
      const t = document.createElement('template');
      t.innerHTML = x.html;
      for (const n of [...t.content.children]) g(n);
      e.append(...t.content.childNodes);
    } else {
      d(e, x.html);
    }
    a.push(x.target);
  }

  return a;
}

function d(e: HtmlResponseFragmentApplyTarget, h: string): void {
  const t = document.createElement('template');
  t.innerHTML = h;
  const n = firstMorphElement(t.content);
  const s = e.contains(document.activeElement) ? document.activeElement : null;
  const q: HTMLElement[] = [];
  for (const x of e.querySelectorAll<HTMLElement>('[kovo-key]')) {
    if (x.scrollTop) {
      (x as HTMLElement & { s?: number }).s = x.scrollTop;
      q.push(x);
    }
  }

  if (n) {
    m(e, g(n));
  } else {
    e.replaceChildren();
  }
  (s as HTMLElement | null)?.focus();
  for (const x of q) if (x.isConnected) x.scrollTop = (x as HTMLElement & { s: number }).s;
}

function firstMorphElement(content: DocumentFragment): Element | undefined {
  for (const child of content.children) {
    if (isFragmentResourceHint(child)) continue;
    return child;
  }
  return undefined;
}

function isFragmentResourceHint(element: Element): boolean {
  return (
    element.tagName === 'LINK' &&
    (element.getAttribute('rel') ?? '')
      .split(/\s+/)
      .some((token) => token.toLowerCase() === 'stylesheet')
  );
}

function k(e: Element): string | null {
  return e.getAttribute('kovo-key');
}

function m(c: Element, n: Element): Element {
  if (c.tagName !== n.tagName || k(c) !== k(n)) {
    c.replaceWith(n);
    return n;
  }

  for (let i = c.attributes.length; i--; ) {
    const a = c.attributes[i];
    if (a && !n.hasAttribute(a.name)) c.removeAttribute(a.name);
  }
  for (const a of n.attributes) sa(c, a.name, a.value);

  // SPEC.md §9.1: a focused keyed input/textarea keeps its browser-owned
  // selection state because keyed morph reuses the live element and skips
  // rewriting its children/value.
  if ((c as HTMLInputElement | HTMLTextAreaElement).selectionStart != null) return c;

  u(c, n);
  return c;
}

function sa(e: Element, name: string, v: string): void {
  const n = name.toLowerCase();
  if (r(n)) {
    e.removeAttribute(name);
    return;
  }
  if (n === 'srcset') {
    const s = y(v);
    e.setAttribute(name, s || '#');
    return;
  }
  if (/^(href|src|action|formaction|poster|background|cite|data|ping|xlink:href)$/.test(n)) {
    if (w(v)) {
      e.setAttribute(name, '#');
      return;
    }
  }
  e.setAttribute(name, v);
}

function r(n: string): boolean {
  return /^on|^(srcdoc|style|innerhtml)$/.test(n);
}

function g(e: Element): Element {
  for (const x of [e, ...e.querySelectorAll('*')]) {
    for (const a of [...x.attributes]) sa(x, a.name, a.value);
  }
  return e;
}

function y(v: string): string | null {
  const r: string[] = [];
  for (const c of v.split(',')) {
    const x = c.trim();
    if (x && !w(x.split(/\s/)[0]!)) r.push(x);
  }
  return r.length ? r.join(', ') : null;
}

function w(v: string): boolean {
  const s = v.replace(/[\x00-\x20]/g, '').toLowerCase();
  return /^[a-z][^:]*:/.test(s) && !/^(https?|ftp|mailto|tel):/.test(s);
}

function u(c: Element, n: Element): void {
  const b = new Map(
    Array.from(c.children)
      .map((child) => [k(child), child] as const)
      .filter((entry): entry is [string, Element] => entry[0] !== null),
  );
  const r = Array.from(n.childNodes).map((x) => {
    if (x instanceof Element) {
      const z = k(x);
      const v = z ? b.get(z) : undefined;
      return v ? m(v, x) : g(x.cloneNode(true) as Element);
    }

    return x.cloneNode(true) as ChildNode;
  });

  c.replaceChildren(...r);
}
