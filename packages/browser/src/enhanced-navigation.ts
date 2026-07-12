import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';

export interface EnhancedNavigationRuntimeOptions {
  acceptHeader: string;
  applyDocumentElementAttributes: (current: Element, next: Element) => void;
  applyHead: (nextHead: HTMLHeadElement) => void;
  applyStylePromotion: () => void;
  document: Document;
  morph: (current: Element, next: Element) => Element | undefined;
  /**
   * Retire page-scoped authority (notably the mutation BroadcastChannel) before a fetched
   * document with a different session fingerprint triggers hard navigation (SPEC §9.3).
   */
  onSessionTransition?: () => void;
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
  const security = createBrowserNavigationSecurityControls();
  const doc = options.document;
  const acceptHeader = options.acceptHeader;
  const applyDocumentElementAttributes = options.applyDocumentElementAttributes;
  const applyHead = options.applyHead;
  const applyStylePromotion = options.applyStylePromotion;
  const morph = options.morph;
  const onSessionTransition = options.onSessionTransition;
  const queryAll = options.queryAll;
  const replayScripts = options.replayScripts;
  const replaceBody = options.replaceBody;
  const replaceElementAttributes = options.replaceElementAttributes;
  const runTriggers = options.runTriggers;
  if (
    typeof acceptHeader !== 'string' ||
    !doc ||
    typeof applyDocumentElementAttributes !== 'function' ||
    typeof applyHead !== 'function' ||
    typeof applyStylePromotion !== 'function' ||
    typeof morph !== 'function' ||
    (onSessionTransition !== undefined && typeof onSessionTransition !== 'function') ||
    typeof queryAll !== 'function' ||
    typeof replayScripts !== 'function' ||
    typeof replaceBody !== 'function' ||
    typeof replaceElementAttributes !== 'function' ||
    typeof runTriggers !== 'function'
  ) {
    throw new TypeError('Kovo enhanced-navigation options are invalid.');
  }
  const historyObject = globalThis.history;
  const sc: Record<string, [number, number]> = {};
  let cu = security.currentUrl()?.href ?? '';
  let ni = 0;

  const kb = (root: ParentNode = doc) =>
    security.readAttribute(security.queryOne(root, 'meta[name="kovo-build"]'), 'content') || '';
  const sessionFingerprint = (root: ParentNode = doc) =>
    security.readAttribute(security.queryOne(root, 'meta[name="kovo-session"]'), 'content') ??
    undefined;
  const qa = (root: ParentNode, selector: string) =>
    security.call<Element[]>(queryAll, undefined, [root, selector]);
  const ns = (root: ParentNode) => qa(root, '[kovo-nav-segment]');
  const nk = (el: Element) =>
    security.readAttribute(el, 'kovo-nav-segment') +
    '|' +
    security.readAttribute(el, 'kovo-nav-kind') +
    '|' +
    security.readAttribute(el, 'kovo-nav-name') +
    '|' +
    (security.readAttribute(el, 'kovo-nav-queries') || '') +
    '|' +
    (security.readAttribute(el, 'kovo-nav-components') || '');
  const nc = (el: Element) => {
    const copy = el.cloneNode(true) as Element;
    const children = qa(copy, '[kovo-nav-segment]');
    for (let index = 0; index < children.length; index += 1) children[index]?.remove();
    return copy.outerHTML;
  };
  const di = (root: Element) => {
    const ids: Record<string, true> = {};
    const add = (el: Element) => {
      const id = security.readAttribute(el, 'id') || (el as HTMLElement).id;
      if (id) ids['$' + id] = true;
    };
    add(root);
    const descendants = qa(root, '[id]');
    for (let index = 0; index < descendants.length; index += 1) {
      const descendant = descendants[index];
      if (descendant) add(descendant);
    }
    return ids;
  };
  const pi = (segments: Element[], end: number) => {
    const ids: Record<string, true> = {};
    for (let i = 0; i < end; i += 1) {
      const copy = segments[i]!.cloneNode(true) as Element;
      const children = qa(copy, '[kovo-nav-segment]');
      for (let index = 0; index < children.length; index += 1) children[index]?.remove();
      const copyIds = di(copy);
      for (const key in copyIds) ids[key] = true;
    }
    return ids;
  };
  const dc = (preserved: Record<string, true>, next: Element) => {
    const nextIds = di(next);
    for (const key in nextIds) if (preserved[key]) return true;
    return false;
  };
  const ng = (href: string) => {
    if (historyObject?.scrollRestoration !== undefined) {
      historyObject.scrollRestoration = 'auto';
    }
    security.hardNavigate(href);
  };
  const sf = (href: string) => {
    const x = globalThis.scrollX || globalThis.pageXOffset || 0;
    const y = globalThis.scrollY || globalThis.pageYOffset || 0;
    if (href) sc[href] = [x, y];
  };
  const hid = (hash: string) => {
    let value = '';
    for (let index = 1; index < hash.length; index += 1) value += hash[index];
    return security.decodeComponent(value) ?? value;
  };
  const ht = (hash: string) => {
    let raw = '';
    for (let index = 1; index < hash.length; index += 1) raw += hash[index];
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
    const elements = qa(doc, 'body *');
    for (let index = 0; index < elements.length; index += 1) {
      const el = elements[index];
      if (!el) continue;
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
      const currentUrl = security.currentUrl();
      const requestedUrl = currentUrl ? security.parseUrl(href, currentUrl.href) : undefined;
      if (!currentUrl || !requestedUrl || requestedUrl.origin !== currentUrl.origin) throw Error();
      const response = await security.fetchDocument(requestedUrl.href, acceptHeader);
      if (navId !== ni) return;
      const responseUrl = security.readResponseField(response, 'url');
      let finalUrl = security.parseUrl(
        typeof responseUrl === 'string' && responseUrl ? responseUrl : requestedUrl.href,
        currentUrl.href,
      );
      if (finalUrl && !finalUrl.hash && requestedUrl.hash) {
        finalUrl = security.parseUrl(finalUrl.href + requestedUrl.hash);
      }
      const contentType = security.readHeader(response, 'content-type');
      if (
        !finalUrl ||
        finalUrl.origin !== currentUrl.origin ||
        !security.isHtmlContentType(contentType)
      ) {
        throw Error();
      }
      const nextDoc = security.parseHtmlDocument(await security.readResponseText(response));
      if (navId !== ni) return;
      const nextBody = security.readDocumentField(nextDoc, 'body') as
        | HTMLBodyElement
        | undefined;
      const nextHead = security.readDocumentField(nextDoc, 'head') as
        | HTMLHeadElement
        | undefined;
      const nextDocumentElement = security.readDocumentField(nextDoc, 'documentElement') as
        | Element
        | undefined;
      const currentBody = security.readDocumentField(doc, 'body') as HTMLBodyElement | undefined;
      const currentDocumentElement = security.readDocumentField(doc, 'documentElement') as
        | Element
        | undefined;
      if (
        !nextDoc ||
        !nextBody ||
        !nextHead ||
        !nextDocumentElement ||
        !currentBody ||
        !currentDocumentElement ||
        kb() !== kb(nextDoc)
      ) {
        throw Error();
      }
      // SPEC §9.3: BroadcastChannel is origin-scoped, not principal-scoped. Enhanced navigation
      // keeps this JavaScript realm alive, so applying a fetched document with a different
      // `kovo-session` meta would otherwise leave the page-load principal closure installed over
      // the new principal's DOM. Compare presence as well as value before ANY head/body mutation;
      // retire the old runtime, then let a hard navigation install a fresh loader and fingerprint.
      if (sessionFingerprint() !== sessionFingerprint(nextDoc)) {
        onSessionTransition?.();
        ng(finalUrl.href);
        return;
      }
      const currentSegments = ns(currentBody);
      const nextSegments = ns(nextBody);
      if (!nextSegments.length) throw Error();
      let triggerRoot: Element | undefined;
      await vt(() => {
        if (
          security.queryOne(nextDoc, 'script[data-kovo-csp-hash]') ||
          !currentSegments.length ||
          currentSegments.length !== nextSegments.length
        ) {
          const islands = qa(currentBody, '[kovo-c]');
          for (let index = 0; index < islands.length; index += 1) {
            (islands[index] as { a?: AbortController } | undefined)?.a?.abort();
          }
          triggerRoot = replaceBody(nextBody as HTMLBodyElement);
        } else {
          const same: boolean[] = [];
          for (let index = 0; index < currentSegments.length; index += 1) {
            const segment = currentSegments[index];
            const nextSegment = nextSegments[index];
            same[index] =
              !!segment &&
              !!nextSegment &&
              nk(segment) === nk(nextSegment) &&
              nc(segment) === nc(nextSegment);
          }
          if (!same[0]) {
            const islands = qa(currentBody, '[kovo-c]');
            for (let index = 0; index < islands.length; index += 1) {
              (islands[index] as { a?: AbortController } | undefined)?.a?.abort();
            }
            triggerRoot = replaceBody(nextBody as HTMLBodyElement);
          } else {
            const preserved: Element[] = [];
            for (let index = 0; index < currentSegments.length; index += 1) {
              const segment = currentSegments[index];
              if (same[index] && segment) preserved[preserved.length] = segment;
            }
            const preservedIds = pi(preserved, preserved.length);
            const changed: boolean[] = [];
            for (let index = 1; index < currentSegments.length; index += 1) {
              if (same[index]) continue;
              let parentChanged = false;
              for (let other = 0; other < index; other += 1) {
                if (
                  changed[other] &&
                  currentSegments[other]?.contains?.(currentSegments[index]!)
                ) {
                  parentChanged = true;
                  break;
                }
              }
              if (parentChanged) continue;
              if (dc(preservedIds, nextSegments[index]!)) throw Error();
              changed[index] = true;
              const islands = qa(currentSegments[index]!, '[kovo-c]');
              for (let islandIndex = 0; islandIndex < islands.length; islandIndex += 1) {
                (islands[islandIndex] as { a?: AbortController } | undefined)?.a?.abort();
              }
              triggerRoot =
                morph(currentSegments[index]!, nextSegments[index]!) || triggerRoot;
            }
          }
        }
        applyHead(nextHead);
        applyStylePromotion();
        applyDocumentElementAttributes(currentDocumentElement, nextDocumentElement);
        const body =
          (security.readDocumentField(doc, 'body') as HTMLBodyElement | undefined) || triggerRoot;
        if (!body) throw Error();
        replaceElementAttributes(body, nextBody);
        replayScripts(body);
      });
      const body =
        (security.readDocumentField(doc, 'body') as HTMLBodyElement | undefined) || triggerRoot;
      if (!body) throw Error();
      const historyPushState = historyObject?.pushState;
      if (!pop && historyObject && typeof historyPushState === 'function') {
        security.call(historyPushState, historyObject, [{}, '', finalUrl.href]);
      }
      const focusTarget =
        security.queryOne(doc, 'main,h1') ?? security.queryOne(doc, '[kovo-nav-segment]');
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
      if (triggerRoot) setTimeout(runTriggers);
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
    const currentUrl = security.currentUrl();
    const url = currentUrl ? security.parseUrl(anchor.href, currentUrl.href) : undefined;
    if (!currentUrl || !url || url.origin !== currentUrl.origin) return false;
    if (url.pathname === currentUrl.pathname && url.search === currentUrl.search && url.hash) {
      return false;
    }
    event.preventDefault();
    sf(currentUrl.href);
    void navigate(url.href);
    return true;
  };

  if (globalThis.history?.scrollRestoration !== undefined) {
    globalThis.history.scrollRestoration = 'manual';
  }

  const handlePopState = () => {
    sf(cu);
    const href = security.currentUrl()?.href;
    if (href) void navigate(href, true);
  };

  return { handleClick, handlePopState, navigate, saveScroll: sf };
}
