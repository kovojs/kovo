export interface DocumentLifecycleRecoveryOptions {
  acceptHeader: string;
  /** Boot-pinned EventTarget enrollment; structural fake targets remain supported in tests. */
  addLifecycleEventListener: (type: string, listener: (event: unknown) => void) => boolean;
  applyBody: (body: string, build?: string) => void;
  buildHeader: (response: unknown) => string;
  currentBuild: (root?: ParentNode) => string;
  currentHref: () => string | undefined;
  document: Document;
  encodeAttribute: (value: string) => string;
  fetchValue: (input: string, init: object) => Promise<unknown>;
  findTarget: (root: ParentNode, target: string) => Element | undefined;
  liveTargets: () => string[];
  parseHtmlDocument: (value: string) => Document | undefined;
  /** Boot-pinned real-document query used by the session-dependent bfcache guard. */
  queryOne: (root: ParentNode, selector: string) => Element | null;
  queryUrl: (wireKey: string) => string;
  readAttribute: (attrs: string, name: string) => string | null;
  readElementAttribute: (
    element: { attrs?: string; attributes?: readonly unknown[] } | string,
    name: string,
  ) => { present: boolean };
  queryAll: (root: ParentNode, selector: string) => Element[];
  /** Boot-pinned PageTransitionEvent.persisted read; uncertainty fails toward refresh/reload. */
  readPageTransitionPersisted: (event: unknown) => boolean;
  readResponseStatus: (response: unknown) => number | undefined;
  readResponseText: (response: unknown) => Promise<string>;
  reload: () => boolean;
  /** Boot-pinned serialization for fetched live-target truth (SPEC §6.6/§8). */
  snapshotElementHtml: (element: Element) => string | undefined;
  targetHeader: () => string[];
  wireKey: (name: string | null, key: string | null) => string;
}

export interface DocumentLifecycleRecovery {
  install(navigation: { handlePopState(): void }): void;
  isDeltaQuery(query: { attrs: string; attributes?: readonly unknown[] }): boolean;
  refreshLiveTargets(): void;
  refreshQuery(query: string | { attrs: string; attributes?: readonly unknown[] }): void;
  rememberQueryChunk(query: { attrs: string; attributes?: readonly unknown[] }): void;
  rememberQueryScripts(): void;
  visibleReturnRefresh(): void;
}

export function createDocumentLifecycleRecovery(
  options: DocumentLifecycleRecoveryOptions,
): DocumentLifecycleRecovery {
  const doc = options.document;
  const fqs = new Set<string>();
  const isDeltaQuery = (query: { attrs: string; attributes?: readonly unknown[] }) =>
    options.readElementAttribute(query, 'delta').present;
  const refreshQuery = (query: string | { attrs: string; attributes?: readonly unknown[] }) => {
    const u =
      typeof query === 'string'
        ? options.queryUrl(query)
        : options.queryUrl(
            options.wireKey(
              options.readAttribute(query.attrs, 'name'),
              options.readAttribute(query.attrs, 'key'),
            ),
          );
    if (!u) return;
    options
      .fetchValue(u, {
        cache: 'no-store',
        headers: { Accept: 'text/html', 'Kovo-Fragment': 'true' },
        method: 'GET',
      })
      .then((res) => {
        const status = options.readResponseStatus(res);
        if (status === undefined || status >= 400) return;
        if (
          options.currentBuild() &&
          (!options.buildHeader(res) || options.buildHeader(res) !== options.currentBuild())
        ) {
          options.reload();
          return;
        }
        return options
          .readResponseText(res)
          .then((text) => options.applyBody(text, options.buildHeader(res)));
      })
      .catch(() => {});
  };
  const refreshLiveTargets = () => {
    const live = options.liveTargets();
    if (!live.length) return;
    const href = options.currentHref();
    if (!href) return;
    options
      .fetchValue(href, {
        cache: 'no-store',
        headers: {
          Accept: options.acceptHeader,
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': lifecycleJoin(live, '; '),
          'Kovo-Targets': lifecycleJoin(options.targetHeader(), '; '),
        },
        method: 'GET',
      })
      .then((res) => {
        const status = options.readResponseStatus(res);
        if (status === undefined || status >= 400) return;
        const responseBuild = options.buildHeader(res);
        if (options.currentBuild() && responseBuild && responseBuild !== options.currentBuild()) {
          options.reload();
          return;
        }
        return options.readResponseText(res).then((text) => {
          if (
            lifecycleContains(text, '<kovo-fragment') ||
            lifecycleContains(text, '<kovo-query') ||
            lifecycleContains(text, '<kovo-text')
          ) {
            options.applyBody(text, responseBuild || options.currentBuild());
            return;
          }
          const nextDoc = options.parseHtmlDocument(text);
          if (!nextDoc) return;
          const nextBuild = responseBuild || options.currentBuild(nextDoc);
          if (options.currentBuild() && (!nextBuild || nextBuild !== options.currentBuild())) {
            options.reload();
            return;
          }
          let fragments = '';
          const seen = new Set<string>();
          for (let index = 0; index < live.length; index += 1) {
            const entry = live[index];
            if (entry === undefined) continue;
            const target = lifecycleBeforeHash(entry);
            if (!target || seen.has(target)) continue;
            seen.add(target);
            const next = options.findTarget(nextDoc, target);
            if (next) {
              const nextHtml = options.snapshotElementHtml(next);
              if (nextHtml === undefined) continue;
              fragments +=
                '<kovo-fragment target="' +
                options.encodeAttribute(target) +
                '">' +
                nextHtml +
                '</kovo-fragment>';
            }
          }
          if (fragments.length) options.applyBody(fragments, nextBuild || options.currentBuild());
        });
      })
      .catch(() => {});
  };
  const rememberQueryChunk = (query: { attrs: string; attributes?: readonly unknown[] }) => {
    const w = options.wireKey(
      options.readAttribute(query.attrs, 'name'),
      options.readAttribute(query.attrs, 'key'),
    );
    if (w) fqs.add(w);
  };
  const rememberQueryScripts = () => {
    for (const script of options.queryAll(doc, 'script[kovo-query]')) {
      const w = options.wireKey(script.getAttribute?.('kovo-query'), script.getAttribute?.('key'));
      if (w) fqs.add(w);
    }
  };
  const visibleReturnRefresh = () => {
    rememberQueryScripts();
    for (const query of fqs) refreshQuery(query);
    refreshLiveTargets();
  };
  const install = (navigation: { handlePopState(): void }) => {
    const listen = (type: string, listener: (event: unknown) => void) => {
      if (!options.addLifecycleEventListener(type, listener)) {
        throw new TypeError('Kovo document lifecycle listener enrollment failed.');
      }
    };
    listen('popstate', () => navigation.handlePopState());
    rememberQueryScripts();
    listen('visibilitychange', () => {
      if (doc.visibilityState === 'hidden') return;
      visibleReturnRefresh();
    });
    listen('pageshow', (event) => {
      if (options.readPageTransitionPersisted(event)) visibleReturnRefresh();
    });
    // SPEC.md §8: guarded/session-dependent bfcache restores must revalidate
    // with a full server GET rather than presenting a persisted authenticated DOM.
    if (options.queryOne(doc, 'meta[name="kovo-session"]')) {
      listen('pageshow', (event) => {
        if (options.readPageTransitionPersisted(event)) options.reload();
      });
    }
  };

  return {
    install,
    isDeltaQuery,
    refreshLiveTargets,
    refreshQuery,
    rememberQueryChunk,
    rememberQueryScripts,
    visibleReturnRefresh,
  };
}

function lifecycleBeforeHash(value: string): string {
  let target = '';
  for (let index = 0; index < value.length && value[index] !== '#'; index += 1) {
    target += value[index];
  }
  return target;
}

function lifecycleContains(value: string, search: string): boolean {
  for (let offset = 0; offset + search.length <= value.length; offset += 1) {
    let equal = true;
    for (let index = 0; index < search.length; index += 1) {
      if (value[offset + index] !== search[index]) {
        equal = false;
        break;
      }
    }
    if (equal) return true;
  }
  return false;
}

function lifecycleJoin(values: readonly string[], separator: string): string {
  let result = '';
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) continue;
    result += (result === '' ? '' : separator) + value;
  }
  return result;
}
