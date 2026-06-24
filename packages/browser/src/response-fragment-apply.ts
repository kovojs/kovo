import type { FragmentChunk } from './wire-response-scanner.js';

// SF-WIRE (secure-framework Tier 3, Trusted Types — DEFERRED): the `p` and `d` helpers
// below (their `insertAdjacentHTML('beforeend', …)` and `t.innerHTML = h` raw-HTML write
// sinks) are EXTRACTED VERBATIM into the always-on inline loader by `inline-loader-build.ts`
// (the `responseApply` spec; a byte-parity test pins the generated `inline-loader.ts`), and
// that extractor forbids referencing any top-level binding. So unlike the module-side sinks
// in `morph.ts`/`query-bindings.ts` — which DO route through `kovoCreateHTML` (trusted-types.ts)
// and are verified non-breaking by the browser suite — these two sinks CANNOT call
// `kovoCreateHTML`. Routing them needs the `kovo` Trusted Types policy embedded INSIDE the
// extracted closures (and minified under the 8.75KB §4.4 budget) via `inline-loader-build.ts`,
// which is outside this slice's edited files. This is the load-bearing reason the strict CSP's
// `require-trusted-types-for 'script'` directive (server `csp.ts` `trustedTypes`) stays OPT-IN
// and is NEVER default-on: enabling it before this always-on loader is routed would BRICK
// Kovo's own hydration on Chromium. CSP (Task 1) is the cross-browser floor and IS default-on;
// Trusted Types is Chromium-only DiD and ships opt-in until this loader path is wired.

export interface ResponseFragmentApplyOptions<Target> {
  appendFragment(target: Target, html: string): void;
  findFragmentTarget(target: string): Target | null | undefined;
  replaceFragment(target: Target, html: string): void;
}

export interface HtmlResponseFragmentApplyTarget extends Element {
  insertAdjacentHTML(position: 'beforeend', html: string): void;
}

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
      e.insertAdjacentHTML('beforeend', x.html);
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
  for (const x of e.querySelectorAll<HTMLElement>('[kovo-key]'))
    if (x.scrollTop) {
      (x as HTMLElement & { s?: number }).s = x.scrollTop;
      q.push(x);
    }

  if (n) {
    m(e, n);
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
  for (const a of n.attributes) c.setAttribute(a.name, a.value);

  // SPEC.md §9.1: a focused keyed input/textarea keeps its browser-owned
  // selection state because keyed morph reuses the live element and skips
  // rewriting its children/value.
  if ((c as HTMLInputElement | HTMLTextAreaElement).selectionStart != null) return c;

  u(c, n);
  return c;
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
      return v ? m(v, x) : (x.cloneNode(true) as ChildNode);
    }

    return x.cloneNode(true) as ChildNode;
  });

  c.replaceChildren(...r);
}
