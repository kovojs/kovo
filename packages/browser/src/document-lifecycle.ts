export interface DocumentLifecycleRecoveryOptions {
  acceptHeader: string;
  applyBody: (body: string, build?: string) => void;
  buildHeader: (response: Response) => string;
  currentBuild: (root?: ParentNode) => string;
  document: Document;
  encodeAttribute: (value: string) => string;
  findTarget: (root: ParentNode, target: string) => Element | undefined;
  liveTargets: () => string[];
  queryUrl: (wireKey: string) => string;
  readAttribute: (attrs: string, name: string) => string | null;
  readElementAttribute: (
    element: { attrs?: string; attributes?: readonly unknown[] } | string,
    name: string,
  ) => { present: boolean };
  queryAll: (root: ParentNode, selector: string) => Element[];
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
    fetch(u, {
      cache: 'no-store',
      headers: { Accept: 'text/html', 'Kovo-Fragment': 'true' },
      method: 'GET',
    })
      .then((res) => {
        if (res.status >= 400) return;
        if (
          options.currentBuild() &&
          (!options.buildHeader(res) || options.buildHeader(res) !== options.currentBuild())
        ) {
          location.reload?.();
          return;
        }
        return res.text().then((text) => options.applyBody(text, options.buildHeader(res)));
      })
      .catch(() => {});
  };
  const refreshLiveTargets = () => {
    const live = options.liveTargets();
    if (!live.length) return;
    fetch(location.href, {
      cache: 'no-store',
      headers: {
        Accept: options.acceptHeader,
        'Kovo-Fragment': 'true',
        'Kovo-Live-Targets': live.join('; '),
        'Kovo-Targets': options.targetHeader().join('; '),
      },
      method: 'GET',
    })
      .then((res) => {
        if (res.status >= 400) return;
        const responseBuild = options.buildHeader(res);
        if (options.currentBuild() && responseBuild && responseBuild !== options.currentBuild()) {
          location.reload?.();
          return;
        }
        return res.text().then((text) => {
          if (
            text.includes('<kovo-fragment') ||
            text.includes('<kovo-query') ||
            text.includes('<kovo-text')
          ) {
            options.applyBody(text, responseBuild || options.currentBuild());
            return;
          }
          const nextDoc = new DOMParser().parseFromString(text, 'text/html');
          const nextBuild = responseBuild || options.currentBuild(nextDoc);
          if (options.currentBuild() && (!nextBuild || nextBuild !== options.currentBuild())) {
            location.reload?.();
            return;
          }
          const fragments: string[] = [];
          const seen = new Set<string>();
          for (const entry of live) {
            const target = entry.split('#')[0];
            if (!target || seen.has(target)) continue;
            seen.add(target);
            const next = options.findTarget(nextDoc, target);
            if (next) {
              fragments.push(
                '<kovo-fragment target="' +
                  options.encodeAttribute(target) +
                  '">' +
                  next.outerHTML +
                  '</kovo-fragment>',
              );
            }
          }
          if (fragments.length)
            options.applyBody(fragments.join(''), nextBuild || options.currentBuild());
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
    addEventListener('popstate', () => navigation.handlePopState());
    rememberQueryScripts();
    addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'hidden') return;
      visibleReturnRefresh();
    });
    addEventListener('pageshow', (event) => {
      if (event.persisted) visibleReturnRefresh();
    });
    // SPEC.md §8: guarded/session-dependent bfcache restores must revalidate
    // with a full server GET rather than presenting a persisted authenticated DOM.
    if (doc.querySelector?.('meta[name="kovo-session"]')) {
      addEventListener('pageshow', (event) => {
        if (event.persisted) location.reload?.();
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
