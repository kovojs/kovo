import type {
  FrameworkTargetRequestHeaderPlan,
  FrameworkWireEntrySnapshot,
} from '@kovojs/core/internal/wire-input-grammar';
import { frameworkWireIdentityIsValid } from '@kovojs/core/internal/wire-input-grammar';

import {
  securityArrayAppend,
  securityGetOwnPropertyDescriptor,
} from './security-witness-intrinsics.js';
import type { QueryIdentity } from './query-store.js';
import { createQueryIdentity } from './query-store.js';

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
  liveTargets: () => readonly FrameworkWireEntrySnapshot[];
  parseHtmlDocument: (value: string) => Document | undefined;
  /** Core-owned exact target-bearing request planner (SPEC §9.1). */
  planTargetRequestHeaders: (input: {
    currentUrl: string;
    liveTargets: readonly FrameworkWireEntrySnapshot[];
    targets: readonly FrameworkWireEntrySnapshot[];
  }) => FrameworkTargetRequestHeaderPlan | undefined;
  /** Boot-pinned real-document query used by the session-dependent bfcache guard. */
  queryOne: (root: ParentNode, selector: string) => Element | null;
  queryUrl: (identity: QueryIdentity) => string;
  readAttribute: (attrs: string, name: string) => string | null;
  readElementAttribute: (
    element: { attrs?: string; attributes?: readonly unknown[] } | string,
    name: string,
  ) => { present: boolean };
  queryAll: (root: ParentNode, selector: string) => Element[];
  /** Boot-pinned PageTransitionEvent.persisted read; uncertainty fails toward refresh/reload. */
  readPageTransitionPersisted: (event: unknown) => boolean;
  /** Boot-pinned DOM attribute read for server-authored query-script identity. */
  readDomAttribute: (element: Element, name: string) => string | null;
  /** Boot-pinned, ASCII-lowercased response Content-Type used to distinguish wire from document. */
  responseContentType: (response: unknown) => string;
  responseAllowsInlineBody: (response: unknown) => boolean;
  readResponseStatus: (response: unknown) => number | undefined;
  readResponseText: (response: unknown) => Promise<string>;
  reload: () => boolean;
  /** Boot-pinned serialization for fetched live-target truth (SPEC §6.6/§8). */
  snapshotElementHtml: (element: Element) => string | undefined;
  targetHeader: () => readonly FrameworkWireEntrySnapshot[];
  wireKey: (name: string | null, key: string | null) => QueryIdentity | undefined;
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
  // SPEC.md §6.6 rule 5: the lifecycle boundary retains these controls across later authored
  // module execution, so classify-and-pin every option exactly once. Inherited/accessor options
  // and later carrier mutation must never replace URL, credential-bearing fetch, or apply sinks.
  const acceptHeader = lifecycleStringOption(options, 'acceptHeader');
  const addLifecycleEventListener = lifecycleFunctionOption<
    DocumentLifecycleRecoveryOptions['addLifecycleEventListener']
  >(options, 'addLifecycleEventListener');
  const applyBody = lifecycleFunctionOption<DocumentLifecycleRecoveryOptions['applyBody']>(
    options,
    'applyBody',
  );
  const buildHeader = lifecycleFunctionOption<DocumentLifecycleRecoveryOptions['buildHeader']>(
    options,
    'buildHeader',
  );
  const currentBuild = lifecycleFunctionOption<DocumentLifecycleRecoveryOptions['currentBuild']>(
    options,
    'currentBuild',
  );
  const currentHref = lifecycleFunctionOption<DocumentLifecycleRecoveryOptions['currentHref']>(
    options,
    'currentHref',
  );
  const doc = lifecycleObjectOption<Document>(options, 'document');
  const encodeAttribute = lifecycleFunctionOption<
    DocumentLifecycleRecoveryOptions['encodeAttribute']
  >(options, 'encodeAttribute');
  const fetchValue = lifecycleFunctionOption<DocumentLifecycleRecoveryOptions['fetchValue']>(
    options,
    'fetchValue',
  );
  const findTarget = lifecycleFunctionOption<DocumentLifecycleRecoveryOptions['findTarget']>(
    options,
    'findTarget',
  );
  const liveTargets = lifecycleFunctionOption<DocumentLifecycleRecoveryOptions['liveTargets']>(
    options,
    'liveTargets',
  );
  const parseHtmlDocument = lifecycleFunctionOption<
    DocumentLifecycleRecoveryOptions['parseHtmlDocument']
  >(options, 'parseHtmlDocument');
  const planTargetRequestHeaders = lifecycleFunctionOption<
    DocumentLifecycleRecoveryOptions['planTargetRequestHeaders']
  >(options, 'planTargetRequestHeaders');
  const queryOne = lifecycleFunctionOption<DocumentLifecycleRecoveryOptions['queryOne']>(
    options,
    'queryOne',
  );
  const queryUrl = lifecycleFunctionOption<DocumentLifecycleRecoveryOptions['queryUrl']>(
    options,
    'queryUrl',
  );
  const readAttribute = lifecycleFunctionOption<DocumentLifecycleRecoveryOptions['readAttribute']>(
    options,
    'readAttribute',
  );
  const readElementAttribute = lifecycleFunctionOption<
    DocumentLifecycleRecoveryOptions['readElementAttribute']
  >(options, 'readElementAttribute');
  const queryAll = lifecycleFunctionOption<DocumentLifecycleRecoveryOptions['queryAll']>(
    options,
    'queryAll',
  );
  const readPageTransitionPersisted = lifecycleFunctionOption<
    DocumentLifecycleRecoveryOptions['readPageTransitionPersisted']
  >(options, 'readPageTransitionPersisted');
  const readDomAttribute = lifecycleFunctionOption<
    DocumentLifecycleRecoveryOptions['readDomAttribute']
  >(options, 'readDomAttribute');
  const responseContentType = lifecycleFunctionOption<
    DocumentLifecycleRecoveryOptions['responseContentType']
  >(options, 'responseContentType');
  const responseAllowsInlineBody = lifecycleFunctionOption<
    DocumentLifecycleRecoveryOptions['responseAllowsInlineBody']
  >(options, 'responseAllowsInlineBody');
  const readResponseStatus = lifecycleFunctionOption<
    DocumentLifecycleRecoveryOptions['readResponseStatus']
  >(options, 'readResponseStatus');
  const readResponseText = lifecycleFunctionOption<
    DocumentLifecycleRecoveryOptions['readResponseText']
  >(options, 'readResponseText');
  const reload = lifecycleFunctionOption<DocumentLifecycleRecoveryOptions['reload']>(
    options,
    'reload',
  );
  const snapshotElementHtml = lifecycleFunctionOption<
    DocumentLifecycleRecoveryOptions['snapshotElementHtml']
  >(options, 'snapshotElementHtml');
  const targetHeader = lifecycleFunctionOption<DocumentLifecycleRecoveryOptions['targetHeader']>(
    options,
    'targetHeader',
  );
  const wireKey = lifecycleFunctionOption<DocumentLifecycleRecoveryOptions['wireKey']>(
    options,
    'wireKey',
  );
  // SPEC §6.6/§9.1.1: the active app-build token is page-load authority. Snapshot it once so
  // authored DOM changes cannot weaken later visibility/pageshow recovery checks.
  const pageBuild = currentBuild();
  const fqs: QueryIdentity[] = [];
  const isDeltaQuery = (query: { attrs: string; attributes?: readonly unknown[] }) =>
    readElementAttribute(query, 'delta').present;
  const refreshQueryIdentity = (identity: QueryIdentity) => {
    let snapshot: QueryIdentity;
    let u: string;
    try {
      snapshot = lifecycleSnapshotQueryIdentity(identity, 'Kovo lifecycle refresh query');
      u = queryUrl(snapshot);
    } catch {
      reload();
      return;
    }
    if (!u) return;
    void (async () => {
      try {
        const res = await fetchValue(u, {
          cache: 'no-store',
          headers: { Accept: 'text/html', 'Kovo-Fragment': 'true' },
          method: 'GET',
        });
        const status = readResponseStatus(res);
        if (status === undefined || status >= 400) return;
        if (!responseAllowsInlineBody(res)) {
          reload();
          return;
        }
        const activeBuild = pageBuild;
        const responseBuild = buildHeader(res);
        if (!activeBuild || !responseBuild || responseBuild !== activeBuild) {
          reload();
          return;
        }
        if (!lifecycleMediaTypeEquals(responseContentType(res), 'text/vnd.kovo.fragment+html')) {
          reload();
          return;
        }
        const text = await readResponseText(res);
        applyBody(text, responseBuild);
      } catch {}
    })();
  };
  const refreshQuery = (query: string | { attrs: string; attributes?: readonly unknown[] }) => {
    try {
      const identity =
        typeof query === 'string'
          ? createQueryIdentity(query)
          : wireKey(readAttribute(query.attrs, 'name'), readAttribute(query.attrs, 'key'));
      if (identity) refreshQueryIdentity(identity);
    } catch {
      reload();
    }
  };
  const refreshLiveTargets = () => {
    let live: FrameworkWireEntrySnapshot[];
    let targets: FrameworkWireEntrySnapshot[];
    try {
      live = lifecycleSnapshotWireEntries(liveTargets(), 'Kovo lifecycle live targets');
      targets = lifecycleSnapshotWireEntries(targetHeader(), 'Kovo lifecycle target header');
    } catch {
      reload();
      return;
    }
    if (!live.length) return;
    const href = currentHref();
    if (!href) {
      reload();
      return;
    }
    const requestPlan = planTargetRequestHeaders({ currentUrl: href, liveTargets: live, targets });
    if (!requestPlan) {
      reload();
      return;
    }
    void (async () => {
      try {
        const res = await fetchValue(href, {
          cache: 'no-store',
          headers: {
            Accept: acceptHeader,
            ...requestPlan.headers,
          },
          method: 'GET',
          referrerPolicy: 'origin',
        });
        const status = readResponseStatus(res);
        if (status === undefined || status >= 400) {
          reload();
          return;
        }
        if (!responseAllowsInlineBody(res)) {
          reload();
          return;
        }
        const activeBuild = pageBuild;
        const responseBuild = buildHeader(res);
        if (!activeBuild || !responseBuild || responseBuild !== activeBuild) {
          reload();
          return;
        }
        const text = await readResponseText(res);
        const contentType = responseContentType(res);
        if (lifecycleMediaTypeEquals(contentType, 'text/vnd.kovo.fragment+html')) {
          // The exact wire media type is transport grammar. Never infer it from protocol-looking
          // substrings that can also occur inside a full deferred HTML document.
          applyBody(text, responseBuild);
          return;
        }
        if (
          lifecycleMediaTypeEquals(contentType, 'text/html') ||
          lifecycleMediaTypeEquals(contentType, 'text/vnd.kovo.document+html')
        ) {
          const nextDoc = parseHtmlDocument(text);
          if (!nextDoc) {
            reload();
            return;
          }
          const documentBuild = currentBuild(nextDoc);
          if (
            !activeBuild ||
            !responseBuild ||
            !documentBuild ||
            responseBuild !== activeBuild ||
            documentBuild !== activeBuild
          ) {
            reload();
            return;
          }
          let fragments = '';
          const seen: string[] = [];
          for (let index = 0; index < requestPlan.liveTargets.length; index += 1) {
            const entry = requestPlan.liveTargets[index];
            if (entry === undefined) continue;
            const target = entry.target;
            if (!target || lifecycleIncludes(seen, target)) continue;
            securityArrayAppend(seen, target, 'Kovo lifecycle seen live targets');
            const next = findTarget(nextDoc, target);
            if (next) {
              const nextHtml = snapshotElementHtml(next);
              if (nextHtml === undefined) continue;
              fragments +=
                '<kovo-fragment target="' +
                encodeAttribute(target) +
                '">' +
                nextHtml +
                '</kovo-fragment>';
            }
          }
          if (fragments.length) applyBody(fragments, responseBuild);
          return;
        }
        reload();
      } catch {
        reload();
      }
    })();
  };
  const rememberQueryChunk = (query: { attrs: string; attributes?: readonly unknown[] }) => {
    try {
      const w = wireKey(readAttribute(query.attrs, 'name'), readAttribute(query.attrs, 'key'));
      if (w) lifecycleRememberQueryIdentity(fqs, w);
    } catch {
      reload();
    }
  };
  const rememberQueryScripts = () => {
    const scripts = lifecycleSnapshotOwnArray<Element>(
      queryAll(doc, 'script[kovo-query]'),
      'Kovo lifecycle query scripts',
    );
    for (let index = 0; index < scripts.length; index += 1) {
      const script = scripts[index];
      if (!script) continue;
      try {
        const w = wireKey(readDomAttribute(script, 'kovo-query'), readDomAttribute(script, 'key'));
        if (w) lifecycleRememberQueryIdentity(fqs, w);
      } catch {
        reload();
        return;
      }
    }
  };
  const visibleReturnRefresh = () => {
    rememberQueryScripts();
    let remembered: QueryIdentity[];
    try {
      remembered = lifecycleSnapshotQueryIdentities(fqs, 'Kovo lifecycle remembered queries');
    } catch {
      reload();
      return;
    }
    for (let index = 0; index < remembered.length; index += 1) {
      const query = remembered[index];
      if (query !== undefined) refreshQueryIdentity(query);
    }
    refreshLiveTargets();
  };
  const install = (navigation: { handlePopState(): void }) => {
    const handlePopState = lifecycleFunctionOption<() => void>(navigation, 'handlePopState');
    const listen = (type: string, listener: (event: unknown) => void) => {
      if (!addLifecycleEventListener(type, listener)) {
        throw new TypeError('Kovo document lifecycle listener enrollment failed.');
      }
    };
    listen('popstate', () => handlePopState());
    rememberQueryScripts();
    listen('visibilitychange', () => {
      if (doc.visibilityState === 'hidden') return;
      visibleReturnRefresh();
    });
    listen('pageshow', (event) => {
      if (readPageTransitionPersisted(event)) visibleReturnRefresh();
    });
    // SPEC.md §8: guarded/session-dependent bfcache restores must revalidate
    // with a full server GET rather than presenting a persisted authenticated DOM.
    if (queryOne(doc, 'meta[name="kovo-session-dependent"]')) {
      listen('pageshow', (event) => {
        if (readPageTransitionPersisted(event)) reload();
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

function lifecycleOwnDataOption(options: object, property: string): unknown {
  const descriptor = securityGetOwnPropertyDescriptor(options, property);
  if (!descriptor) {
    throw new TypeError('Kovo document lifecycle option ' + property + ' is required.');
  }
  if (!('value' in descriptor)) {
    throw new TypeError(
      'Kovo document lifecycle option ' + property + ' must be an own-data property.',
    );
  }
  return descriptor.value;
}

function lifecycleFunctionOption<FunctionValue extends Function>(
  options: object,
  property: string,
): FunctionValue {
  const value = lifecycleOwnDataOption(options, property);
  if (typeof value !== 'function') {
    throw new TypeError('Kovo document lifecycle option ' + property + ' must be a function.');
  }
  return value as FunctionValue;
}

function lifecycleStringOption(options: object, property: string): string {
  const value = lifecycleOwnDataOption(options, property);
  if (typeof value !== 'string') {
    throw new TypeError('Kovo document lifecycle option ' + property + ' must be a string.');
  }
  return value;
}

function lifecycleObjectOption<ObjectValue extends object>(
  options: object,
  property: string,
): ObjectValue {
  const value = lifecycleOwnDataOption(options, property);
  if (value === null || typeof value !== 'object') {
    throw new TypeError('Kovo document lifecycle option ' + property + ' must be an object.');
  }
  return value as ObjectValue;
}

function lifecycleSnapshotOwnArray<Value>(value: unknown, label: string): Value[] {
  if (value === null || typeof value !== 'object') {
    throw new TypeError(label + ' must be an own-data array.');
  }
  const lengthDescriptor = securityGetOwnPropertyDescriptor(value, 'length');
  const length =
    lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : undefined;
  if (typeof length !== 'number' || length < 0 || length > 100_000 || length % 1 !== 0) {
    throw new TypeError(label + ' must have a bounded own-data length.');
  }
  const snapshot: Value[] = [];
  for (let index = 0; index < length; index += 1) {
    const entry = securityGetOwnPropertyDescriptor(value, index);
    if (!entry || !('value' in entry)) {
      throw new TypeError(label + ' must contain dense own-data entries.');
    }
    securityArrayAppend(snapshot, entry.value as Value, label);
  }
  return snapshot;
}

function lifecycleSnapshotWireEntries(value: unknown, label: string): FrameworkWireEntrySnapshot[] {
  const values = lifecycleSnapshotOwnArray<unknown>(value, label);
  const snapshot: FrameworkWireEntrySnapshot[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const entry = values[index];
    if (entry === null || typeof entry !== 'object') {
      throw new TypeError(label + ' entries must be wire snapshots.');
    }
    const target = securityGetOwnPropertyDescriptor(entry, 'target');
    const wireEntry = securityGetOwnPropertyDescriptor(entry, 'wireEntry');
    if (
      !target ||
      !('value' in target) ||
      typeof target.value !== 'string' ||
      !wireEntry ||
      !('value' in wireEntry) ||
      typeof wireEntry.value !== 'string'
    ) {
      throw new TypeError(label + ' entries must contain semantic and wire identities.');
    }
    securityArrayAppend(snapshot, { target: target.value, wireEntry: wireEntry.value }, label);
  }
  return snapshot;
}

function lifecycleSnapshotQueryIdentities(value: unknown, label: string): QueryIdentity[] {
  const values = lifecycleSnapshotOwnArray<unknown>(value, label);
  const snapshot: QueryIdentity[] = [];
  for (let index = 0; index < values.length; index += 1) {
    securityArrayAppend(
      snapshot,
      lifecycleSnapshotQueryIdentity(values[index], label + ' entry'),
      label,
    );
  }
  return snapshot;
}

function lifecycleSnapshotQueryIdentity(value: unknown, label: string): QueryIdentity {
  if (value === null || typeof value !== 'object') {
    throw new TypeError(label + ' must be a query identity.');
  }
  const name = securityGetOwnPropertyDescriptor(value, 'name');
  const key = securityGetOwnPropertyDescriptor(value, 'key');
  if (!name || !('value' in name) || !frameworkWireIdentityIsValid(name.value)) {
    throw new TypeError(label + ' must contain a non-empty valid scalar query name.');
  }
  if (key && (!('value' in key) || !frameworkWireIdentityIsValid(key.value))) {
    throw new TypeError(label + ' key must be non-empty own-data valid scalar text.');
  }
  return createQueryIdentity(name.value, key && 'value' in key ? (key.value as string) : undefined);
}

function lifecycleIncludes(values: readonly string[], value: string): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === value) return true;
  }
  return false;
}

function lifecycleRememberQueryIdentity(values: QueryIdentity[], value: QueryIdentity): void {
  const snapshot = lifecycleSnapshotQueryIdentity(value, 'Kovo lifecycle remembered query');
  for (let index = 0; index < values.length; index += 1) {
    const existing = values[index];
    if (existing && existing.name === snapshot.name && existing.key === snapshot.key) return;
  }
  securityArrayAppend(values, snapshot, 'Kovo lifecycle remembered queries');
}

function lifecycleMediaTypeEquals(value: unknown, expected: string): boolean {
  if (typeof value !== 'string') return false;
  let offset = 0;
  while (value[offset] === ' ' || value[offset] === '\t') offset += 1;
  for (let index = 0; index < expected.length; index += 1) {
    const character = value[offset + index];
    if (character === undefined || character !== expected[index]) return false;
  }
  offset += expected.length;
  while (value[offset] === ' ' || value[offset] === '\t') offset += 1;
  return offset === value.length || value[offset] === ';';
}
