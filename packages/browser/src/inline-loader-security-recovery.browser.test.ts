import { afterEach, expect, it, vi } from 'vitest';

import { inlineKovoLoaderInstallerSource } from './inline-loader.js';

type FrameHarness = {
  frame: HTMLIFrameElement;
  loadCount(): number;
  window: Window & typeof globalThis;
};

const frames: HTMLIFrameElement[] = [];

async function createFrame(body: string, head: string): Promise<FrameHarness> {
  const frame = document.createElement('iframe');
  let loads = 0;
  frame.addEventListener('load', () => {
    loads += 1;
  });
  frame.src = `/__kovo_inline_security_fixture?case=${frames.length}`;
  frames.push(frame);
  document.body.append(frame);
  await vi.waitFor(() => expect(loads).toBe(1));
  const frameWindow = frame.contentWindow;
  if (!frameWindow) throw new Error('missing iframe window');
  frameWindow.document.open();
  frameWindow.document.write(
    `<!doctype html><html><head>${head}</head><body>${body}</body></html>`,
  );
  frameWindow.document.close();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const baselineLoads = loads;
  return {
    frame,
    loadCount: () => loads - baselineLoads + 1,
    window: frameWindow as Window & typeof globalThis,
  };
}

async function createOpaqueFrame(body: string): Promise<FrameHarness> {
  const frame = document.createElement('iframe');
  let loads = 0;
  frame.addEventListener('load', () => {
    loads += 1;
  });
  frame.srcdoc = `<!doctype html><html><head></head><body>${body}</body></html>`;
  frames.push(frame);
  document.body.append(frame);
  await vi.waitFor(() => expect(loads).toBe(1));
  const frameWindow = frame.contentWindow;
  if (!frameWindow) throw new Error('missing opaque iframe window');
  return {
    frame,
    loadCount: () => loads,
    window: frameWindow as Window & typeof globalThis,
  };
}

async function installGeneratedInlineLoader(
  frameWindow: Window & typeof globalThis,
  importModule: (url: string) => Promise<Record<string, unknown>> = async () => ({}),
): Promise<void> {
  const globalRecord = frameWindow as unknown as Record<string, unknown>;
  globalRecord.__kovoBrowserTestImport = importModule;
  let scriptError: unknown;
  frameWindow.addEventListener('error', (event) => {
    scriptError = event.error ?? event.message;
  });
  const script = frameWindow.document.createElement('script');
  script.textContent = `(${inlineKovoLoaderInstallerSource})(globalThis.__kovoBrowserTestImport);`;
  frameWindow.document.head.append(script);
  await Promise.resolve();
  if (scriptError) throw scriptError;
}

async function runSandboxOriginProbe(
  mode: 'full' | 'paint',
  source: string,
): Promise<{
  clickPrevented: boolean;
  effectiveOrigin: string;
  fetchCalls: number;
  importCalls: number;
  locationOrigin: string;
  submitPrevented: boolean;
}> {
  const frame = document.createElement('iframe');
  frame.sandbox.add('allow-scripts', 'allow-forms');
  const id = `sandbox-origin-${frames.length}`;
  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
  });
  frame.src = `/__kovo_inline_security_fixture?sandbox-origin-probe=${frames.length}`;
  frames.push(frame);
  document.body.append(frame);
  await loaded;
  const result = new Promise<{
    clickPrevented: boolean;
    effectiveOrigin: string;
    fetchCalls: number;
    importCalls: number;
    locationOrigin: string;
    submitPrevented: boolean;
  }>((resolve, reject) => {
    const listener = (event: MessageEvent) => {
      const value = event.data as { error?: unknown; id?: unknown; type?: unknown };
      if (
        event.source !== frame.contentWindow ||
        value?.type !== 'kovo:sandbox-origin-result' ||
        value.id !== id
      ) {
        return;
      }
      window.removeEventListener('message', listener);
      if (value.error) reject(new Error(String(value.error)));
      else resolve(event.data);
    };
    window.addEventListener('message', listener);
  });
  frame.contentWindow?.postMessage({ id, mode, source, type: 'kovo:sandbox-origin-probe' }, '*');
  return result;
}

function responseHeaders(build: string | undefined, contentType = 'text/html') {
  return {
    get(name: string) {
      if (name.toLowerCase() === 'kovo-build') return build ?? null;
      if (name.toLowerCase() === 'content-type') return contentType;
      return null;
    },
  };
}

function frameStream(
  frameWindow: Window & typeof globalThis,
  parts: readonly string[],
): ReadableStream<Uint8Array> {
  const Encoder = frameWindow.TextEncoder;
  const Stream = frameWindow.ReadableStream;
  return new Stream<Uint8Array>({
    start(controller) {
      const encoder = new Encoder();
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
  vi.restoreAllMocks();
});

it('ignores a caller-owned Trusted Types policy cache before generated fragment apply', async () => {
  const harness = await createFrame(
    '<section kovo-fragment-target="victim"><span>OLD</span></section>',
    '<meta name="kovo-build" content="build-a">',
  );
  const globalRecord = harness.window as unknown as Record<string, unknown>;
  globalRecord.__kovo_tt = {
    createHTML() {
      return '<img data-kovo-policy-cache-attack src="x">';
    },
  };

  await installGeneratedInlineLoader(harness.window);
  const apply = globalRecord.__kovo_a;
  if (typeof apply !== 'function') throw new Error('generated fragment apply is unavailable');
  apply(
    [
      '<kovo-fragment target="victim">',
      '<section kovo-fragment-target="victim"><strong data-kovo-policy-safe>SAFE</strong></section>',
      '</kovo-fragment>',
    ].join(''),
  );

  expect(harness.window.document.querySelector('[data-kovo-policy-cache-attack]')).toBeNull();
  expect(harness.window.document.querySelector('[data-kovo-policy-safe]')?.textContent).toBe(
    'SAFE',
  );
});

it('replaces retired live output when Array iteration is poisoned after generated install', async () => {
  // SPEC §6.6/§9.2: late app prototype changes cannot skip the decision that
  // retires an old live component before a replacement fragment is committed.
  const harness = await createFrame(
    '<section kovo-fragment-target="victim"><div kovo-c="old-live">OLD</div></section>',
    '<meta name="kovo-build" content="build-a">',
  );
  await installGeneratedInlineLoader(harness.window);
  const globalRecord = harness.window as unknown as Record<string, unknown>;
  const apply = globalRecord.__kovo_a;
  if (typeof apply !== 'function') throw new Error('generated fragment apply is unavailable');
  const oldLive = harness.window.document.querySelector('[kovo-c="old-live"]');
  if (!oldLive) throw new Error('missing old live component');
  const originalIterator = harness.window.Array.prototype[Symbol.iterator];

  try {
    harness.window.Array.prototype[Symbol.iterator] = function () {
      return { next: () => ({ done: true, value: undefined }) } as ArrayIterator<unknown>;
    };
    apply(
      '<kovo-fragment target="victim"><section kovo-fragment-target="victim"><p>NEW</p></section></kovo-fragment>',
    );
  } finally {
    harness.window.Array.prototype[Symbol.iterator] = originalIterator;
  }

  expect(harness.window.document.querySelector('[kovo-c="old-live"]')).toBeNull();
  expect(
    harness.window.document.querySelector('[kovo-fragment-target="victim"] p')?.textContent,
  ).toBe('NEW');
});

it('replaces retired live output when String.includes is poisoned after generated install', async () => {
  // SPEC §6.6/§9.2: a late String prototype poison cannot forge the fragment
  // identity comparison and preserve a live producer whose output was removed.
  const harness = await createFrame(
    '<section kovo-fragment-target="victim"><div kovo-c="old-live">OLD</div></section>',
    '<meta name="kovo-build" content="build-a">',
  );
  await installGeneratedInlineLoader(harness.window);
  const globalRecord = harness.window as unknown as Record<string, unknown>;
  const apply = globalRecord.__kovo_a;
  if (typeof apply !== 'function') throw new Error('generated fragment apply is unavailable');
  const oldLive = harness.window.document.querySelector('[kovo-c="old-live"]');
  if (!oldLive) throw new Error('missing old live component');
  const originalIncludes = harness.window.String.prototype.includes;

  try {
    harness.window.String.prototype.includes = () => true;
    apply(
      '<kovo-fragment target="victim"><section kovo-fragment-target="victim"><p>NEW</p></section></kovo-fragment>',
    );
  } finally {
    harness.window.String.prototype.includes = originalIncludes;
  }

  expect(harness.window.document.querySelector('[kovo-c="old-live"]')).toBeNull();
  expect(
    harness.window.document.querySelector('[kovo-fragment-target="victim"] p')?.textContent,
  ).toBe('NEW');
});

it('fails closed when the Trusted Types factory was replaced before generated install', async () => {
  const harness = await createFrame(
    '<section kovo-fragment-target="victim"><span>OLD</span></section>',
    '<meta name="kovo-build" content="build-a">',
  );
  const factory = harness.window.trustedTypes;
  const factoryPrototype = Object.getPrototypeOf(factory) as object;
  const createPolicyDescriptor = Object.getOwnPropertyDescriptor(factoryPrototype, 'createPolicy');
  if (
    !createPolicyDescriptor ||
    !('value' in createPolicyDescriptor) ||
    typeof createPolicyDescriptor.value !== 'function'
  ) {
    throw new Error('Trusted Types factory control unavailable');
  }
  Object.defineProperty(factoryPrototype, 'createPolicy', {
    ...createPolicyDescriptor,
    value() {
      return {
        createHTML() {
          return '<img data-kovo-import-order-policy-attack src="x">';
        },
      };
    },
  });
  try {
    await installGeneratedInlineLoader(harness.window);
  } finally {
    Object.defineProperty(factoryPrototype, 'createPolicy', createPolicyDescriptor);
  }

  const globalRecord = harness.window as unknown as Record<string, unknown>;
  const apply = globalRecord.__kovo_a;
  if (typeof apply !== 'function') throw new Error('generated fragment apply is unavailable');
  apply(
    [
      '<kovo-fragment target="victim">',
      '<section kovo-fragment-target="victim"><strong data-kovo-import-order-safe>SAFE</strong></section>',
      '</kovo-fragment>',
    ].join(''),
  );

  expect(
    harness.window.document.querySelector('[data-kovo-import-order-policy-attack]'),
  ).toBeNull();
  expect(harness.window.document.querySelector('[data-kovo-import-order-safe]')?.textContent).toBe(
    'SAFE',
  );
});

it.each(['before', 'after'] as const)(
  'keeps generated fragment bytes exact when TrustedHTML stringification changes %s install',
  async (timing) => {
    const harness = await createFrame(
      '<section kovo-fragment-target="victim"><span>OLD</span></section>',
      '<meta name="kovo-build" content="build-a">',
    );
    const descriptor = Object.getOwnPropertyDescriptor(
      harness.window.TrustedHTML.prototype,
      'toString',
    );
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
      throw new Error('TrustedHTML stringifier control unavailable');
    }
    const poison = () => {
      Object.defineProperty(harness.window.TrustedHTML.prototype, 'toString', {
        ...descriptor,
        value() {
          return '<img data-c227-generated-attack src="x">';
        },
      });
    };
    if (timing === 'before') poison();
    try {
      await installGeneratedInlineLoader(harness.window);
      if (timing === 'after') poison();
      const apply = (harness.window as unknown as Record<string, unknown>).__kovo_a;
      if (typeof apply !== 'function') throw new Error('generated fragment apply is unavailable');
      apply(
        [
          '<kovo-fragment target="victim">',
          '<section kovo-fragment-target="victim"><strong data-c227-generated-safe>SAFE</strong></section>',
          '</kovo-fragment>',
        ].join(''),
      );
    } finally {
      Object.defineProperty(harness.window.TrustedHTML.prototype, 'toString', descriptor);
    }

    expect(harness.window.document.querySelector('[data-c227-generated-attack]')).toBeNull();
    expect(harness.window.document.querySelector('[data-c227-generated-safe]')?.textContent).toBe(
      'SAFE',
    );
  },
);

it('fails generated install closed when fetch was changed to an accessor before boot', async () => {
  const harness = await createFrame('<main>SERVER-SAFE</main>', '');
  const descriptor = Object.getOwnPropertyDescriptor(harness.window, 'fetch');
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
    throw new Error('frame fetch control unavailable');
  }
  Object.defineProperty(harness.window, 'fetch', {
    configurable: true,
    enumerable: descriptor.enumerable,
    get: () => async () => new harness.window.Response('ATTACKER'),
  });
  try {
    await expect(installGeneratedInlineLoader(harness.window)).rejects.toThrow();
    expect((harness.window as unknown as Record<string, unknown>).__kovo_a).toBeUndefined();
  } finally {
    Object.defineProperty(harness.window, 'fetch', descriptor);
  }
});

it('keeps generated mutation on the response transport captured at boot', async () => {
  const harness = await createFrame(
    [
      '<main kovo-nav-segment="layout:a" kovo-nav-kind="layout" kovo-nav-name="a">',
      '<section kovo-fragment-target="account">INITIAL</section>',
      '<form enhance data-mutation="account" action="/_m/account" method="post"><button>save</button></form>',
      '</main>',
    ].join(''),
    '<meta name="kovo-build" content="build-a">',
  );
  const globalRecord = harness.window as unknown as Record<string, unknown>;
  const safeFetch = vi.fn(async () => ({
    headers: responseHeaders('build-a', 'text/vnd.kovo.fragment+html'),
    ok: true,
    status: 200,
    async text() {
      return '<kovo-fragment target="account"><section kovo-fragment-target="account">MUTATION SERVER SAFE</section></kovo-fragment>';
    },
    url: `${harness.window.location.origin}/_m/account`,
  }));
  const attackFetch = vi.fn(async () => ({
    headers: responseHeaders('build-a', 'text/vnd.kovo.fragment+html'),
    async text() {
      return '<kovo-fragment target="account"><section kovo-fragment-target="account">ATTACKER</section></kovo-fragment>';
    },
    url: `${harness.window.location.origin}/_m/account`,
  }));
  globalRecord.fetch = safeFetch;

  await installGeneratedInlineLoader(harness.window);
  globalRecord.fetch = attackFetch;
  harness.window.document
    .querySelector<HTMLFormElement>('form')
    ?.dispatchEvent(new harness.window.SubmitEvent('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(
      harness.window.document.querySelector('[kovo-fragment-target="account"]')?.textContent,
    ).toBe('MUTATION SERVER SAFE'),
  );

  expect(safeFetch).toHaveBeenCalledTimes(1);
  expect(attackFetch).not.toHaveBeenCalled();
});

it.each(['data:/_m/chat', 'blob:/_m/chat', 'file:/_m/chat'])(
  'leaves %s mutation actions native in an opaque generated-loader document',
  async (action) => {
    const harness = await createOpaqueFrame(
      `<form enhance data-mutation="chat" action="${action}" method="post"><button>send</button></form>`,
    );
    const fetch = vi.fn();
    (harness.window as unknown as Record<string, unknown>).fetch = fetch;
    expect(harness.window.location.href).toBe('about:srcdoc');
    expect(harness.window.location.origin).toBe('null');
    const actionUrl = new harness.window.URL(action, harness.window.location.href);
    expect(actionUrl.protocol).toBe(action.slice(0, action.indexOf(':') + 1));
    expect(action.startsWith('file:') ? ['null', 'file://'] : ['null']).toContain(actionUrl.origin);

    await installGeneratedInlineLoader(harness.window);
    const form = harness.window.document.querySelector('form');
    if (!form) throw new Error('missing opaque mutation form');
    const event = new harness.window.SubmitEvent('submit', {
      bubbles: true,
      cancelable: true,
    });
    form.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  },
);

it('rejects enhanced authority in an opaque-origin sandboxed network document', async () => {
  const result = await runSandboxOriginProbe('full', inlineKovoLoaderInstallerSource);

  expect(result.locationOrigin).toBe(location.origin);
  expect(result.effectiveOrigin).toBe('null');
  expect(result.submitPrevented).toBe(false);
  expect(result.clickPrevented).toBe(false);
  expect(result.fetchCalls).toBe(0);
  expect(result.importCalls).toBe(0);
});

it.each([
  ['empty formaction', 'formaction=""'],
  ['empty formmethod', 'formmethod=""'],
  ['empty formaction and formmethod', 'formaction="" formmethod=""'],
] as const)(
  'leaves a submitter with %s native in the generated mutation loader',
  async (_name, submitterAttributes) => {
    const harness = await createFrame(
      [
        '<form data-mutation="delete" action="/_m/delete" method="post">',
        `<button id="delete" ${submitterAttributes}>delete</button>`,
        '</form>',
      ].join(''),
      '',
    );
    const fetch = vi.fn();
    (harness.window as unknown as Record<string, unknown>).fetch = fetch;
    await installGeneratedInlineLoader(harness.window);

    const form = harness.window.document.querySelector('form');
    const submitter = harness.window.document.querySelector<HTMLButtonElement>('#delete');
    if (!form || !submitter) throw new Error('missing submitter override fixture');
    const event = new harness.window.SubmitEvent('submit', {
      bubbles: true,
      cancelable: true,
      submitter,
    });
    form.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  },
);

it('matches the live document base for mutation and navigation targets', async () => {
  const harness = await createFrame(
    [
      '<form data-mutation="delete" action="/_m/delete" method="post">',
      '<button id="delete" formaction="_m/delete" formmethod="post">delete</button>',
      '</form>',
      '<a id="account" href="account">account</a>',
    ].join(''),
    '<base href="/safe/">',
  );
  const fetch = vi.fn(() => new Promise<Response>(() => {}));
  (harness.window as unknown as Record<string, unknown>).fetch = fetch;
  await installGeneratedInlineLoader(harness.window);

  const form = harness.window.document.querySelector('form');
  const submitter = harness.window.document.querySelector<HTMLButtonElement>('#delete');
  const anchor = harness.window.document.querySelector<HTMLAnchorElement>('#account');
  if (!form || !submitter || !anchor) throw new Error('missing document-base fixture');
  expect(new harness.window.URL(submitter.formAction).pathname).toBe('/safe/_m/delete');
  expect(new harness.window.URL(anchor.href).pathname).toBe('/safe/account');

  const submitEvent = new harness.window.SubmitEvent('submit', {
    bubbles: true,
    cancelable: true,
    submitter,
  });
  form.dispatchEvent(submitEvent);
  const clickEvent = new harness.window.MouseEvent('click', { bubbles: true, cancelable: true });
  anchor.dispatchEvent(clickEvent);

  expect(submitEvent.defaultPrevented).toBe(false);
  expect(clickEvent.defaultPrevented).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[0]).toBe(`${harness.window.location.origin}/safe/account`);
});

it('recovers an ambiguous mutation failure with one POST and one fresh replay key', async () => {
  const renderedIdem = 'idem_rendered_old';
  const harness = await createFrame(
    [
      '<form data-mutation="delete" action="/_m/delete" method="post">',
      `<input name="Kovo-Idem" value="${renderedIdem}">`,
      '<button>delete</button>',
      '</form>',
    ].join(''),
    '',
  );
  const form = harness.window.document.querySelector<HTMLFormElement>('form');
  if (!form) throw new Error('missing no-replay mutation fixture');
  const getDescriptor = Object.getOwnPropertyDescriptor(harness.window.FormData.prototype, 'get');
  if (!getDescriptor || !('value' in getDescriptor) || typeof getDescriptor.value !== 'function') {
    throw new Error('missing frame FormData getter');
  }
  let submitEvents = 0;
  form.addEventListener('submit', (event) => {
    submitEvents += 1;
    // Keep the vulnerable requestSubmit retry inside the fixture so it can be counted exactly.
    if (submitEvents > 1) event.preventDefault();
  });
  const attempts: Array<{ bodyIdem: unknown; headerIdem: unknown }> = [];
  const fetch = vi.fn(
    async (_url: string, init: { body: unknown; headers: Record<string, string> }) => {
      attempts.push({
        bodyIdem: Reflect.apply(getDescriptor.value, init.body, ['Kovo-Idem']),
        headerIdem: init.headers['Kovo-Idem'],
      });
      return {
        headers: responseHeaders(undefined, 'text/html'),
        ok: true,
        status: 200,
        async text() {
          return '<html>not fragment truth</html>';
        },
        url: `${harness.window.location.origin}/_m/delete`,
      };
    },
  );
  (harness.window as unknown as Record<string, unknown>).fetch = fetch;

  await installGeneratedInlineLoader(harness.window);
  form.dispatchEvent(new harness.window.SubmitEvent('submit', { bubbles: true, cancelable: true }));

  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(harness.loadCount()).toBeGreaterThan(1));
  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.bodyIdem).toBe(attempts[0]?.headerIdem);
  expect(attempts[0]?.bodyIdem).not.toBe(renderedIdem);
  expect(submitEvents).toBe(1);
});

it('leaves opaque data-document navigation native without fetching it', async () => {
  const attackDocument = encodeURIComponent(
    [
      '<!doctype html><html><head><meta name="kovo-build" content="build-a"></head><body>',
      '<main kovo-nav-segment="layout:opaque" kovo-nav-kind="layout" kovo-nav-name="opaque">',
      '<p id="opaque-navigation-attack">ATTACKER DOCUMENT</p>',
      '</main></body></html>',
    ].join(''),
  );
  const href = `data:text/html,${attackDocument}`;
  const harness = await createOpaqueFrame(
    [
      '<meta name="kovo-build" content="build-a">',
      '<main kovo-nav-segment="layout:opaque" kovo-nav-kind="layout" kovo-nav-name="opaque">',
      `<a id="opaque-navigation" href="${href}">navigate</a>`,
      '<p id="opaque-navigation-safe">SERVER SAFE</p>',
      '</main>',
    ].join(''),
  );
  const fetch = vi.fn(() => new Promise<Response>(() => {}));
  (harness.window as unknown as Record<string, unknown>).fetch = fetch;
  await installGeneratedInlineLoader(harness.window);

  const anchor = harness.window.document.querySelector<HTMLAnchorElement>('#opaque-navigation');
  if (!anchor) throw new Error('missing opaque navigation anchor');
  let preventedByKovo = false;
  anchor.addEventListener(
    'click',
    (event) => {
      preventedByKovo = event.defaultPrevented;
      event.preventDefault();
    },
    { once: true },
  );
  anchor.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true, cancelable: true }));

  expect(harness.window.location.origin).toBe('null');
  expect(new harness.window.URL(href).origin).toBe('null');
  expect(preventedByKovo).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  expect(harness.window.document.querySelector('#opaque-navigation-safe')?.textContent).toBe(
    'SERVER SAFE',
  );
});

it('leaves same-origin blob-document navigation native without fetching it', async () => {
  const harness = await createFrame('<a id="blob-navigation">navigate</a>', '');
  const href = harness.window.URL.createObjectURL(
    new harness.window.Blob(['<!doctype html><html><body>ATTACKER DOCUMENT</body></html>'], {
      type: 'text/html',
    }),
  );
  const anchor = harness.window.document.querySelector<HTMLAnchorElement>('#blob-navigation');
  if (!anchor) throw new Error('missing blob navigation anchor');
  anchor.href = href;
  const fetch = vi.fn(() => new Promise<Response>(() => {}));
  (harness.window as unknown as Record<string, unknown>).fetch = fetch;
  try {
    await installGeneratedInlineLoader(harness.window);
    let preventedByKovo = false;
    anchor.addEventListener(
      'click',
      (event) => {
        preventedByKovo = event.defaultPrevented;
        event.preventDefault();
      },
      { once: true },
    );
    anchor.dispatchEvent(
      new harness.window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    const blobUrl = new harness.window.URL(href);
    expect(blobUrl.origin).toBe(harness.window.location.origin);
    expect(blobUrl.protocol).toBe('blob:');
    expect(preventedByKovo).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    harness.window.URL.revokeObjectURL(href);
  }
});

it('rejects manifest-listed data modules in an opaque generated loader', async () => {
  const moduleUrl = 'data:/c/attacker.client.js';
  const harness = await createOpaqueFrame(
    [
      `<meta data-kovo-module-allowlist="${moduleUrl}">`,
      `<button id="opaque-module" on:click="${moduleUrl}#run">run</button>`,
    ].join(''),
  );
  const run = vi.fn();
  const importModule = vi.fn(async () => ({ run }));
  await installGeneratedInlineLoader(harness.window, importModule);

  harness.window.document
    .querySelector('#opaque-module')
    ?.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await Promise.resolve();
  await Promise.resolve();

  expect(harness.window.location.origin).toBe('null');
  expect(new harness.window.URL(moduleUrl).origin).toBe('null');
  expect(importModule).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

it('keeps generated query and live-target recovery on the captured response transport', async () => {
  const harness = await createFrame(
    [
      '<script type="application/json" kovo-query="cart">{"count":1}</script>',
      '<section kovo-fragment-target="account" kovo-deps="account" kovo-live-component="account" kovo-live-token="tok_account">INITIAL</section>',
    ].join(''),
    '<meta name="kovo-build" content="build-a">',
  );
  const globalRecord = harness.window as unknown as Record<string, unknown>;
  const safeFetch = vi.fn(async (input: string) => ({
    headers: responseHeaders('build-a', 'text/vnd.kovo.fragment+html'),
    status: 200,
    async text() {
      return String(input).includes('/_q/cart')
        ? '<kovo-query name="cart">{"count":2}</kovo-query>'
        : '<kovo-fragment target="account"><section kovo-fragment-target="account">LIVE SERVER SAFE</section></kovo-fragment>';
    },
  }));
  const attackFetch = vi.fn(async () => ({
    headers: responseHeaders('build-a', 'text/vnd.kovo.fragment+html'),
    status: 200,
    async text() {
      return '<kovo-fragment target="account"><section kovo-fragment-target="account">ATTACKER</section></kovo-fragment>';
    },
  }));
  globalRecord.fetch = safeFetch;

  await installGeneratedInlineLoader(harness.window);
  globalRecord.fetch = attackFetch;
  harness.window.dispatchEvent(new harness.window.Event('visibilitychange'));

  await vi.waitFor(() => expect(safeFetch).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(
      harness.window.document.querySelector('[kovo-fragment-target="account"]')?.textContent,
    ).toBe('LIVE SERVER SAFE'),
  );
  expect(attackFetch).not.toHaveBeenCalled();
});

it('retires the old channel when mutable session meta is forged to match the next document', async () => {
  const harness = await createFrame(
    [
      '<main kovo-nav-segment="layout:a" kovo-nav-kind="layout" kovo-nav-name="a">',
      '<a id="switch" href="/__kovo_inline_security_fixture?kovo-session=b">switch</a>',
      '<section kovo-fragment-target="account">A INITIAL</section>',
      '</main>',
    ].join(''),
    [
      '<meta name="kovo-build" content="build-a">',
      '<meta name="kovo-session" content="session-a">',
      '<title>A document</title>',
    ].join(''),
  );
  const oldDocument = harness.window.document;
  const oldAccount = oldDocument.querySelector('[kovo-fragment-target="account"]');
  const broadcastPrototype = harness.window.BroadcastChannel.prototype;
  const onMessageDescriptor = Object.getOwnPropertyDescriptor(broadcastPrototype, 'onmessage');
  if (!onMessageDescriptor?.get || !onMessageDescriptor.set) {
    throw new Error('BroadcastChannel.onmessage controls unavailable');
  }
  const nativeOnMessageGet = onMessageDescriptor.get;
  const nativeOnMessageSet = onMessageDescriptor.set;
  const closeDescriptor = Object.getOwnPropertyDescriptor(broadcastPrototype, 'close');
  if (
    !closeDescriptor ||
    !('value' in closeDescriptor) ||
    typeof closeDescriptor.value !== 'function'
  ) {
    throw new Error('BroadcastChannel.close control unavailable');
  }
  const nativeClose = closeDescriptor.value;
  const subscribedChannels: BroadcastChannel[] = [];
  const closedChannels = new WeakSet<BroadcastChannel>();
  Object.defineProperty(broadcastPrototype, 'onmessage', {
    ...onMessageDescriptor,
    set(this: BroadcastChannel, value: ((event: MessageEvent<unknown>) => void) | null) {
      if (typeof value === 'function' && !subscribedChannels.includes(this)) {
        subscribedChannels.push(this);
      }
      Reflect.apply(nativeOnMessageSet, this, [value]);
    },
  });
  Object.defineProperty(broadcastPrototype, 'close', {
    ...closeDescriptor,
    value(this: BroadcastChannel) {
      closedChannels.add(this);
      Reflect.apply(nativeClose, this, []);
    },
  });
  const targetUrl = `${harness.window.location.origin}/__kovo_inline_security_fixture?kovo-session=b`;
  (harness.window as unknown as Record<string, unknown>).fetch = vi.fn(async () => ({
    headers: responseHeaders('build-a'),
    async text() {
      return [
        '<!doctype html><html><head>',
        '<meta name="kovo-build" content="build-a">',
        '<meta name="kovo-session" content="session-b">',
        '<title>B document</title>',
        '</head><body>',
        '<main kovo-nav-segment="layout:b" kovo-nav-kind="layout" kovo-nav-name="b">',
        '<section kovo-fragment-target="account">B SERVER TRUTH</section>',
        '</main>',
        '</body></html>',
      ].join('');
    },
    url: targetUrl,
  }));

  let runtimeChannel: BroadcastChannel | undefined;
  try {
    await installGeneratedInlineLoader(harness.window);
    await vi.waitFor(() => {
      const activeChannels = subscribedChannels.filter(
        (channel) => Reflect.apply(nativeOnMessageGet, channel, []) !== null,
      );
      expect(activeChannels).toHaveLength(1);
      runtimeChannel = activeChannels[0];
    });
    Object.defineProperty(broadcastPrototype, 'onmessage', onMessageDescriptor);
    if (!runtimeChannel) throw new Error('inline mutation BroadcastChannel unavailable');
    // SPEC §9.3: authored DOM can forge the live marker, but the generated loader's page-load
    // principal remains session-a and must retire before any session-b document is applied.
    oldDocument.querySelector('meta[name="kovo-session"]')?.setAttribute('content', 'session-b');
    oldDocument
      .querySelector<HTMLAnchorElement>('#switch')
      ?.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(closedChannels.has(runtimeChannel!)).toBe(true));
    expect(Reflect.apply(nativeOnMessageGet, runtimeChannel, [])).toBeNull();
    expect(oldAccount?.textContent).toBe('A INITIAL');
    expect(oldDocument.querySelector('meta[name="kovo-session"]')?.getAttribute('content')).toBe(
      'session-b',
    );
  } finally {
    Object.defineProperty(broadcastPrototype, 'onmessage', onMessageDescriptor);
    Object.defineProperty(broadcastPrototype, 'close', closeDescriptor);
  }
});

it.each([
  ['missing-token', undefined],
  ['foreign-token', 'build-new'],
] as const)(
  'cancels a %s stream before getReader and hard-reloads with zero apply',
  async (_posture, responseBuild) => {
    const harness = await createFrame(
      [
        '<form enhance data-mutation="chat" data-mutation-stream action="/_m/chat" method="post"><button>send</button></form>',
        '<section kovo-fragment-target="messages">OLD BUILD TRUTH</section>',
      ].join(''),
      '<meta name="kovo-build" content="build-old">',
    );
    const oldDocument = harness.window.document;
    const oldTarget = oldDocument.querySelector('[kovo-fragment-target="messages"]');
    const cancel = vi.fn(async () => undefined);
    const body = new harness.window.ReadableStream<Uint8Array>({ cancel });
    (harness.window as unknown as Record<string, unknown>).fetch = vi.fn(async () => ({
      body,
      headers: responseHeaders(responseBuild, 'text/vnd.kovo.fragment+html'),
      ok: true,
      status: 200,
      url: `${harness.window.location.origin}/_m/chat`,
    }));

    await installGeneratedInlineLoader(harness.window);
    oldDocument
      .querySelector('form')
      ?.dispatchEvent(
        new harness.window.SubmitEvent('submit', { bubbles: true, cancelable: true }),
      );

    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(body.locked).toBe(false);
    expect(oldTarget?.textContent).toBe('OLD BUILD TRUTH');
    await vi.waitFor(() => expect(harness.loadCount()).toBeGreaterThan(1));
  },
);

it.each([
  [
    'error/replace',
    '<kovo-fragment target="messages"><section kovo-fragment-target="messages">UNCONFIRMED</section></kovo-fragment>',
    '<kovo-done reason="error"></kovo-done>',
  ],
  [
    'aborted/append',
    '<kovo-fragment target="messages" mode="append"><article>UNCONFIRMED</article></kovo-fragment>',
    '<kovo-done reason="aborted"></kovo-done>',
  ],
  [
    'missing-done/prepend',
    '<kovo-fragment target="messages" mode="prepend"><article>UNCONFIRMED</article></kovo-fragment>',
    '',
  ],
] as const)(
  'hard-recovers a progressively applied %s stream',
  async (_name, fragment, terminator) => {
    const harness = await createFrame(
      [
        '<form enhance data-mutation="chat" data-mutation-stream action="/_m/chat" method="post"><button>send</button></form>',
        '<section kovo-fragment-target="messages">AUTHORITATIVE</section>',
      ].join(''),
      '<meta name="kovo-build" content="build-a">',
    );
    const oldDocument = harness.window.document;
    const oldTarget = oldDocument.querySelector('[kovo-fragment-target="messages"]');
    let nativeSubmitCalls = 0;
    const form = oldDocument.querySelector<HTMLFormElement>('form');
    if (!form) throw new Error('missing stream form');
    form.requestSubmit = () => {
      nativeSubmitCalls += 1;
    };
    (harness.window as unknown as Record<string, unknown>).fetch = vi.fn(async () => ({
      body: frameStream(harness.window, [fragment, ...(terminator ? [terminator] : [])]),
      headers: responseHeaders('build-a', 'text/vnd.kovo.fragment+html'),
      ok: true,
      status: 200,
      url: `${harness.window.location.origin}/_m/chat`,
    }));

    await installGeneratedInlineLoader(harness.window);
    form.dispatchEvent(
      new harness.window.SubmitEvent('submit', { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => expect(oldTarget?.textContent).toContain('UNCONFIRMED'));
    await vi.waitFor(() => expect(harness.loadCount()).toBeGreaterThan(1));
    expect(nativeSubmitCalls).toBe(0);
  },
);

it('never consults deferred-runtime native submit after an ambiguous POST failure', async () => {
  const harness = await createFrame(
    [
      '<iframe hidden name="kovo-c210-deferred-sink"></iframe>',
      '<form enhance data-mutation="deferred-runtime" action="/_m/deferred-runtime" method="post" target="kovo-c210-deferred-sink">',
      '<input name="kovo-c210" value="deferred-runtime">',
      '<button>send</button>',
      '</form>',
    ].join(''),
    '',
  );
  const form = harness.window.document.querySelector<HTMLFormElement>('form');
  const sink = harness.window.document.querySelector<HTMLIFrameElement>('iframe');
  if (!form || !sink) throw new Error('missing deferred submit fixture');
  (harness.window as unknown as Record<string, unknown>).fetch = vi.fn(async () => {
    throw new Error('mutation fetch failed');
  });
  const prototype = harness.window.HTMLFormElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'requestSubmit');
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
    throw new Error('native deferred form requestSubmit unavailable');
  }
  const poisonedRequestSubmit = vi.fn();

  await installGeneratedInlineLoader(harness.window);
  Object.defineProperty(prototype, 'requestSubmit', {
    ...descriptor,
    value: poisonedRequestSubmit,
  });
  try {
    form.dispatchEvent(
      new harness.window.SubmitEvent('submit', { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => expect(harness.loadCount()).toBeGreaterThan(1));
    expect(poisonedRequestSubmit).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(prototype, 'requestSubmit', descriptor);
  }
});

it('keeps complete same-build stream behavior without hard recovery', async () => {
  const harness = await createFrame(
    [
      '<form enhance data-mutation="chat" data-mutation-stream action="/_m/chat" method="post"><button>send</button></form>',
      '<section kovo-fragment-target="messages">AUTHORITATIVE</section>',
    ].join(''),
    '<meta name="kovo-build" content="build-a">',
  );
  const frameDocument = harness.window.document;
  (harness.window as unknown as Record<string, unknown>).fetch = vi.fn(async () => ({
    body: frameStream(harness.window, [
      '<kovo-fragment target="messages" mode="append"><article>CONFIRMED</article></kovo-fragment>',
      '<kovo-done reason="complete"></kovo-done>',
    ]),
    headers: responseHeaders('build-a', 'text/vnd.kovo.fragment+html'),
    ok: true,
    status: 200,
    url: `${harness.window.location.origin}/_m/chat`,
  }));

  await installGeneratedInlineLoader(harness.window);
  frameDocument
    .querySelector('form')
    ?.dispatchEvent(new harness.window.SubmitEvent('submit', { bubbles: true, cancelable: true }));

  await vi.waitFor(() =>
    expect(frameDocument.querySelector('[kovo-fragment-target="messages"]')?.textContent).toContain(
      'CONFIRMED',
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(harness.loadCount()).toBe(1);
});
