import { describe, expect, it, vi } from 'vitest';

import {
  createDocumentLifecycleRecovery,
  type DocumentLifecycleRecoveryOptions,
} from './document-lifecycle.js';

function recoveryOptions(overrides: Partial<DocumentLifecycleRecoveryOptions> = {}) {
  const applied: Array<{ body: string; build?: string }> = [];
  const reload = vi.fn(() => true);
  const nextDocument = {} as Document;
  const nextTarget = {} as Element;
  const options: DocumentLifecycleRecoveryOptions = {
    acceptHeader: 'text/html',
    addLifecycleEventListener: () => true,
    applyBody: (body, build) => applied.push(build === undefined ? { body } : { body, build }),
    buildHeader: () => 'build-old',
    currentBuild: (root) => (root === nextDocument ? 'build-old' : 'build-old'),
    currentHref: () => 'https://kovo.test/account',
    document: {} as Document,
    encodeAttribute: (value) => value,
    fetchValue: async () => ({ status: 200 }),
    findTarget: () => nextTarget,
    liveTargets: () => ['account#account@token:{}'],
    parseHtmlDocument: () => nextDocument,
    queryAll: () => [],
    queryOne: () => null,
    queryUrl: () => '',
    readAttribute: () => null,
    readDomAttribute: () => null,
    readElementAttribute: () => ({ present: false }),
    readPageTransitionPersisted: () => false,
    responseContentType: () => 'text/html; charset=utf-8',
    readResponseStatus: () => 200,
    readResponseText: async () => '<html><body>next</body></html>',
    reload,
    snapshotElementHtml: () => '<section kovo-fragment-target="account">next</section>',
    targetHeader: () => [],
    wireKey: () => '',
    ...overrides,
  };
  return { applied, nextDocument, options, reload };
}

async function refresh(options: DocumentLifecycleRecoveryOptions): Promise<void> {
  createDocumentLifecycleRecovery(options).refreshLiveTargets();
  await vi.waitFor(() => expect(options.fetchValue).toHaveBeenCalledOnce());
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('document lifecycle build proof (SPEC §9.1.1/§14)', () => {
  it('reloads instead of stamping the active build onto wire bytes with no response proof', async () => {
    const fetchValue = vi.fn(async () => ({ status: 200 }));
    const { applied, options, reload } = recoveryOptions({
      buildHeader: () => '',
      fetchValue,
      responseContentType: () => 'text/vnd.kovo.fragment+html; charset=utf-8',
      readResponseText: async () => '<kovo-fragment target="account">NEW-BUILD</kovo-fragment>',
    });

    await refresh(options);

    expect(reload).toHaveBeenCalledOnce();
    expect(applied).toEqual([]);
  });

  it('requires the response header and fetched document meta to agree with the pinned page', async () => {
    const fetchValue = vi.fn(async () => ({ status: 200 }));
    const { applied, nextDocument, options, reload } = recoveryOptions({
      currentBuild: (root) => (root === nextDocument ? 'build-new' : 'build-old'),
      fetchValue,
    });

    await refresh(options);

    expect(reload).toHaveBeenCalledOnce();
    expect(applied).toEqual([]);
  });

  it('treats a full document containing protocol tags as a document, not a wire body', async () => {
    const fetchValue = vi.fn(async () => ({ status: 200 }));
    const { applied, nextDocument, options, reload } = recoveryOptions({
      currentBuild: (root) => (root === nextDocument ? 'build-new' : 'build-old'),
      fetchValue,
      readResponseText: async () =>
        '<!doctype html><html><head><meta name="kovo-build" content="build-new"></head>' +
        '<body><kovo-fragment target="deferred">NEW BUILD</kovo-fragment></body></html>',
      responseContentType: () => 'text/html; charset=utf-8',
    });

    await refresh(options);

    expect(reload).toHaveBeenCalledOnce();
    expect(applied).toEqual([]);
  });

  it('applies a reconstructed target only under matching header, document, and page proof', async () => {
    const fetchValue = vi.fn(async () => ({ status: 200 }));
    const { applied, options, reload } = recoveryOptions({ fetchValue });

    await refresh(options);

    expect(reload).not.toHaveBeenCalled();
    expect(applied).toEqual([
      {
        body: '<kovo-fragment target="account"><section kovo-fragment-target="account">next</section></kovo-fragment>',
        build: 'build-old',
      },
    ]);
  });
});
