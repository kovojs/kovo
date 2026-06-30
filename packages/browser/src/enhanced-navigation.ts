export interface EnhancedNavigationRuntimeOptions {
  acceptHeader: string;
  applyDocumentElementAttributes: (current: Element, next: Element) => void;
  applyHead: (nextHead: HTMLHeadElement) => void;
  applyStylePromotion: () => void;
  document: Document;
  morph: (current: Element, next: Element) => Element | undefined;
  queryAll: (root: ParentNode, selector: string) => Element[];
  replayScripts: (root: ParentNode) => void;
  replaceBody: (nextBody: HTMLBodyElement) => HTMLBodyElement;
  replaceElementAttributes: (current: Element, next: Element) => void;
  runTriggers: () => void;
}

export interface EnhancedNavigationRuntime {
  handlePopState(): void;
  handleClick(event: MouseEvent): boolean;
  navigate(href: string, pop?: boolean): Promise<void>;
  saveScroll(href: string): void;
}

export function installEnhancedNavigationRuntime(
  options: EnhancedNavigationRuntimeOptions,
): EnhancedNavigationRuntime {
  const doc = options.document;
  const sc: Record<string, [number, number]> = {};
  let cu = location.href;
  let ni = 0;

  const kb = (root: ParentNode = doc) =>
    root.querySelector?.('meta[name="kovo-build"]')?.getAttribute('content') || '';
  const ns = (root: ParentNode) => [...root.querySelectorAll('[kovo-nav-segment]')];
  const nk = (el: Element) =>
    [
      el.getAttribute('kovo-nav-segment'),
      el.getAttribute('kovo-nav-kind'),
      el.getAttribute('kovo-nav-name'),
      el.getAttribute('kovo-nav-queries') || '',
      el.getAttribute('kovo-nav-components') || '',
    ].join('|');
  const nc = (el: Element) => {
    const copy = el.cloneNode(true) as Element;
    for (const child of options.queryAll(copy, '[kovo-nav-segment]')) child.remove();
    return copy.outerHTML;
  };
  const di = (root: Element) => {
    const ids = new Set<string>();
    const add = (el: Element) => {
      const id = el.getAttribute?.('id') || (el as HTMLElement).id;
      if (id) ids.add(id);
    };
    add(root);
    for (const el of options.queryAll(root, '[id]')) add(el);
    return ids;
  };
  const pi = (segments: Element[], end: number) => {
    const ids = new Set<string>();
    for (let i = 0; i < end; i += 1) {
      const copy = segments[i]!.cloneNode(true) as Element;
      for (const child of options.queryAll(copy, '[kovo-nav-segment]')) child.remove();
      for (const id of di(copy)) ids.add(id);
    }
    return ids;
  };
  const dc = (preserved: Set<string>, next: Element) => {
    for (const id of di(next)) if (preserved.has(id)) return true;
    return false;
  };
  const ng = (href: string) => {
    if (globalThis.history?.scrollRestoration !== undefined) {
      globalThis.history.scrollRestoration = 'auto';
    }
    if (location.assign) location.assign(href);
    else location.href = href;
  };
  const sf = (href: string) => {
    const x = globalThis.scrollX || globalThis.pageXOffset || 0;
    const y = globalThis.scrollY || globalThis.pageYOffset || 0;
    if (href) sc[href] = [x, y];
  };
  const hid = (hash: string) => {
    const value = hash.slice(1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  const ht = (hash: string) => {
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
    for (const el of options.queryAll(doc, 'body *')) {
      const style = globalThis.getComputedStyle?.(el);
      if (!style || (style.position !== 'fixed' && style.position !== 'sticky')) continue;
      const top = parseFloat(style.top || '0') || 0;
      const rect = (el as HTMLElement).getBoundingClientRect?.();
      if (top <= 0 && rect && rect.top <= 1 && rect.bottom > offset) offset = rect.bottom;
    }
    return offset;
  };
  const hscl = (hash: string) => {
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
  const vt = async (apply: () => void) => {
    const start = doc.startViewTransition?.bind(doc);
    if (typeof start !== 'function') {
      apply();
      return;
    }
    let ran = false;
    try {
      const transition = start.call(doc, () => {
        ran = true;
        apply();
      });
      await transition?.updateCallbackDone;
    } catch (error) {
      if (!ran) apply();
      else throw error;
    }
  };
  const navigate = async (href: string, pop = false) => {
    const navId = (ni += 1);
    try {
      const requestedUrl = new URL(href, location.href);
      const response = await fetch(href, {
        headers: { Accept: options.acceptHeader },
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
      let triggerRoot: Element | undefined;
      await vt(() => {
        if (
          nextDoc.querySelector('script[data-kovo-csp-hash]') ||
          !currentSegments.length ||
          currentSegments.length !== nextSegments.length
        ) {
          for (const el of options.queryAll(doc.body, '[kovo-c]'))
            (el as { a?: AbortController }).a?.abort();
          triggerRoot = options.replaceBody(nextBody as HTMLBodyElement);
        } else {
          const same = currentSegments.map(
            (segment, index) =>
              nk(segment) === nk(nextSegments[index]!) && nc(segment) === nc(nextSegments[index]!),
          );
          if (!same[0]) {
            for (const el of options.queryAll(doc.body, '[kovo-c]'))
              (el as { a?: AbortController }).a?.abort();
            triggerRoot = options.replaceBody(nextBody as HTMLBodyElement);
          } else {
            const preserved = currentSegments.filter((_segment, index) => same[index]);
            const preservedIds = pi(preserved, preserved.length);
            const changed = new Set<number>();
            for (let index = 1; index < currentSegments.length; index += 1) {
              if (same[index]) continue;
              if (
                currentSegments.some(
                  (segment, other) =>
                    other < index &&
                    changed.has(other) &&
                    segment.contains?.(currentSegments[index]!),
                )
              ) {
                continue;
              }
              if (dc(preservedIds, nextSegments[index]!)) throw Error();
              changed.add(index);
              for (const el of options.queryAll(currentSegments[index]!, '[kovo-c]')) {
                (el as { a?: AbortController }).a?.abort();
              }
              triggerRoot =
                options.morph(currentSegments[index]!, nextSegments[index]!) || triggerRoot;
            }
          }
        }
        options.applyHead(nextDoc.head);
        options.applyStylePromotion();
        options.applyDocumentElementAttributes(doc.documentElement, nextDoc.documentElement);
        const body = doc.body || triggerRoot;
        if (!body) throw Error();
        options.replaceElementAttributes(body, nextBody);
        options.replayScripts(body);
      });
      const body = doc.body || triggerRoot;
      if (!body) throw Error();
      if (!pop) globalThis.history?.pushState?.({}, '', finalUrl.href);
      const focusTarget = doc.querySelector('main,h1') ?? doc.querySelector('[kovo-nav-segment]');
      focusTarget?.setAttribute?.('tabindex', '-1');
      (focusTarget as HTMLElement | null)?.focus?.({ preventScroll: true });
      const saved = sc[finalUrl.href];
      if (pop && saved) globalThis.scrollTo?.(saved[0], saved[1]);
      else if (finalUrl.hash) {
        hscl(finalUrl.hash);
        setTimeout(() => {
          if (navId === ni) hscl(finalUrl.hash);
        });
      } else globalThis.scrollTo?.(0, 0);
      if (triggerRoot) setTimeout(options.runTriggers);
      cu = finalUrl.href;
      dispatchEvent(new CustomEvent('kovo:navigate', { detail: { url: finalUrl.href } }));
    } catch {
      if (navId === ni) ng(href);
    }
  };
  const handleClick = (event: MouseEvent) => {
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
    const target = event.target as Element | null;
    const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (
      !anchor ||
      target?.closest?.('[on\\:click]') ||
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
    void navigate(url.href);
    return true;
  };

  if (globalThis.history?.scrollRestoration !== undefined) {
    globalThis.history.scrollRestoration = 'manual';
  }

  const handlePopState = () => {
    sf(cu);
    void navigate(location.href, true);
  };

  return { handleClick, handlePopState, navigate, saveScroll: sf };
}
