import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';
import { securityArrayAppend } from './security-witness-intrinsics.js';

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
  retireIsland: (island: Element) => void;
  runTriggers: () => void;
  /**
   * The page-load principal fingerprint pinned by the loader. `undefined` is the anonymous
   * posture. This must never be reconstructed from mutable live DOM after installation.
   */
  sessionFingerprint: string | undefined;
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
  const retireIsland = options.retireIsland;
  const runTriggers = options.runTriggers;
  const sessionFingerprint = options.sessionFingerprint;
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
    typeof retireIsland !== 'function' ||
    typeof runTriggers !== 'function' ||
    (sessionFingerprint !== undefined && typeof sessionFingerprint !== 'string')
  ) {
    throw new TypeError('Kovo enhanced-navigation options are invalid.');
  }
  const sc: Record<string, [number, number]> = {};
  let cu = security.currentUrl()?.href ?? '';
  let ni = 0;

  const kb = (root: ParentNode = doc) =>
    security.readAttribute(security.queryOne(root, 'meta[name="kovo-build"]'), 'content') || '';
  // SPEC §6.6/§9.1.1: the page build is loader authority, not mutable authored DOM.
  const pageBuild = kb();
  const readSessionFingerprint = (root: ParentNode) =>
    security.readAttribute(security.queryOne(root, 'meta[name="kovo-session"]'), 'content') ??
    undefined;
  const readSessionDependent = (root: ParentNode) =>
    !!security.queryOne(root, 'meta[name="kovo-session-dependent"]');
  // SPEC §8/§9.3: posture is loader authority too. A session-dependent document without a
  // resolved principal must never be enhanced into another document inside this realm.
  const pageSessionDependent = readSessionDependent(doc);
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
    const copy = security.cloneElement(el);
    if (!copy) throw new TypeError('Kovo navigation segment snapshot is unavailable.');
    const children = qa(copy, '[kovo-nav-segment]');
    for (let index = 0; index < children.length; index += 1) {
      if (children[index] && !security.removeElement(children[index])) {
        throw new TypeError('Kovo navigation segment snapshot is unavailable.');
      }
    }
    const snapshot = security.readElementOuterHtml(copy);
    if (snapshot === undefined) {
      throw new TypeError('Kovo navigation segment snapshot is unavailable.');
    }
    return snapshot;
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
      const copy = security.cloneElement(segments[i]!);
      if (!copy) throw new TypeError('Kovo navigation segment snapshot is unavailable.');
      const children = qa(copy, '[kovo-nav-segment]');
      for (let index = 0; index < children.length; index += 1) {
        if (children[index] && !security.removeElement(children[index])) {
          throw new TypeError('Kovo navigation segment snapshot is unavailable.');
        }
      }
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
    // Best effort only. A poisoned optional scroll setter must never run before or suppress the
    // boot-pinned hard-navigation sink that retires stale server truth (SPEC §6.6/§8).
    security.setHistoryScrollRestoration('auto');
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
  const vt = async (apply: () => void) => security.commitViewTransition(doc, apply);
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
      const nextBody = security.readDocumentField(nextDoc, 'body') as HTMLBodyElement | undefined;
      const nextHead = security.readDocumentField(nextDoc, 'head') as HTMLHeadElement | undefined;
      const nextDocumentElement = security.readDocumentField(nextDoc, 'documentElement') as
        | Element
        | undefined;
      const currentBody = security.readDocumentField(doc, 'body') as HTMLBodyElement | undefined;
      const currentDocumentElement = security.readDocumentField(doc, 'documentElement') as
        | Element
        | undefined;
      const nextBuild = nextDoc ? kb(nextDoc) : '';
      if (
        !nextDoc ||
        !nextBody ||
        !nextHead ||
        !nextDocumentElement ||
        !currentBody ||
        !currentDocumentElement ||
        !pageBuild ||
        !nextBuild ||
        pageBuild !== nextBuild
      ) {
        throw Error();
      }
      // SPEC §9.3: BroadcastChannel is origin-scoped, not principal-scoped. Enhanced navigation
      // keeps this JavaScript realm alive, so applying a fetched document with a different
      // `kovo-session` meta would otherwise leave the page-load principal closure installed over
      // the new principal's DOM. Compare presence as well as value before ANY head/body mutation;
      // retire the old runtime, then let a hard navigation install a fresh loader and fingerprint.
      const nextSessionFingerprint = readSessionFingerprint(nextDoc);
      const nextSessionDependent = readSessionDependent(nextDoc);
      if (
        sessionFingerprint !== nextSessionFingerprint ||
        ((pageSessionDependent || nextSessionDependent) &&
          (!sessionFingerprint || !nextSessionFingerprint))
      ) {
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
            if (islands[index]) security.call(retireIsland, undefined, [islands[index]]);
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
              if (islands[index]) security.call(retireIsland, undefined, [islands[index]]);
            }
            triggerRoot = replaceBody(nextBody as HTMLBodyElement);
          } else {
            const preserved: Element[] = [];
            for (let index = 0; index < currentSegments.length; index += 1) {
              const segment = currentSegments[index];
              if (same[index] && segment)
                securityArrayAppend(
                  preserved,
                  segment,
                  'Browser packages/browser/src/enhanced-navigation.ts collection',
                );
            }
            const preservedIds = pi(preserved, preserved.length);
            const changed: boolean[] = [];
            for (let index = 1; index < currentSegments.length; index += 1) {
              if (same[index]) continue;
              let parentChanged = false;
              for (let other = 0; other < index; other += 1) {
                const possibleParent = currentSegments[other];
                const currentSegment = currentSegments[index];
                if (
                  changed[other] &&
                  possibleParent &&
                  currentSegment &&
                  security.elementContains(possibleParent, currentSegment)
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
                if (islands[islandIndex]) {
                  security.call(retireIsland, undefined, [islands[islandIndex]]);
                }
              }
              triggerRoot = morph(currentSegments[index]!, nextSegments[index]!) || triggerRoot;
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
      const historyObject = globalThis.history;
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
    const eventFacts = security.snapshotDelegatedEvent(event);
    if (
      !eventFacts ||
      eventFacts.type !== 'click' ||
      eventFacts.defaultPrevented ||
      eventFacts.button ||
      eventFacts.metaKey ||
      eventFacts.ctrlKey ||
      eventFacts.shiftKey ||
      eventFacts.altKey
    ) {
      return false;
    }
    const target = eventFacts.target;
    const anchor = security.closestElement(target, 'a[href]');
    const anchorTarget = anchor
      ? (security.readAttribute(anchor, 'target') ?? readOwnNavigationString(anchor, 'target'))
      : undefined;
    if (
      !anchor ||
      security.closestElement(target, '[on\\:click]') ||
      anchorTarget ||
      hasNavigationAttribute(anchor, 'download')
    ) {
      return false;
    }
    const currentUrl = security.currentUrl();
    const href = security.readAttribute(anchor, 'href') ?? readOwnNavigationString(anchor, 'href');
    const url = currentUrl && href ? security.parseUrl(href, currentUrl.href) : undefined;
    if (!currentUrl || !url || url.origin !== currentUrl.origin) return false;
    if (url.pathname === currentUrl.pathname && url.search === currentUrl.search && url.hash) {
      return false;
    }
    if (!security.preventDelegatedEventDefault(event)) return false;
    sf(currentUrl.href);
    void navigate(url.href);
    return true;
  };

  function readOwnNavigationString(value: object, property: PropertyKey): string | undefined {
    const descriptor = security.getOwnSecurityPropertyDescriptor(value, property);
    return descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
      ? descriptor.value
      : undefined;
  }

  function hasNavigationAttribute(value: object, name: string): boolean {
    if (security.readAttribute(value, name) !== null) return true;
    const descriptor = security.getOwnSecurityPropertyDescriptor(value, 'hasAttribute');
    return Boolean(
      descriptor &&
      'value' in descriptor &&
      typeof descriptor.value === 'function' &&
      security.call(descriptor.value, value, [name]) === true,
    );
  }

  security.setHistoryScrollRestoration('manual');

  const handlePopState = () => {
    sf(cu);
    const href = security.currentUrl()?.href;
    if (href) void navigate(href, true);
  };

  return { handleClick, handlePopState, navigate, saveScroll: sf };
}
