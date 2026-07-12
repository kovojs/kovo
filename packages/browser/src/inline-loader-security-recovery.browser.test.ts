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
  frame.srcdoc = `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
  frames.push(frame);
  document.body.append(frame);
  await vi.waitFor(() => expect(loads).toBe(1));
  const frameWindow = frame.contentWindow;
  if (!frameWindow) throw new Error('missing iframe window');
  return {
    frame,
    loadCount: () => loads,
    window: frameWindow as Window & typeof globalThis,
  };
}

async function installGeneratedInlineLoader(
  frameWindow: Window & typeof globalThis,
): Promise<void> {
  const globalRecord = frameWindow as unknown as Record<string, unknown>;
  globalRecord.__kovoBrowserTestImport = async () => ({});
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

it('retires the old channel and hard-navigates before applying a same-build new-session document', async () => {
  const harness = await createFrame(
    [
      '<main kovo-nav-segment="layout:a" kovo-nav-kind="layout" kovo-nav-name="a">',
      '<a id="switch" href="about:srcdoc?kovo-session=b">switch</a>',
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
  const channels: Array<{
    closed: boolean;
    onmessage: ((event: { data: unknown }) => void) | null;
  }> = [];
  (harness.window as unknown as Record<string, unknown>).BroadcastChannel = class {
    closed = false;
    onmessage: ((event: { data: unknown }) => void) | null = null;

    constructor() {
      channels.push(this);
    }

    close(): void {
      this.closed = true;
    }

    postMessage(): void {}
  };
  const targetUrl = 'about:srcdoc?kovo-session=b';
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

  await installGeneratedInlineLoader(harness.window);
  oldDocument
    .querySelector<HTMLAnchorElement>('#switch')
    ?.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true, cancelable: true }));

  await vi.waitFor(() => expect(channels[0]?.closed).toBe(true));
  expect(channels[0]?.onmessage).toBeNull();
  expect(oldAccount?.textContent).toBe('A INITIAL');
  expect(oldDocument.querySelector('meta[name="kovo-session"]')?.getAttribute('content')).toBe(
    'session-a',
  );
});

it.each([
  ['missing-token', undefined],
  ['foreign-token', 'build-new'],
] as const)(
  'cancels a %s stream before getReader and hard-reloads with zero apply',
  async (_posture, responseBuild) => {
    const harness = await createFrame(
      [
        '<form enhance data-mutation-stream action="/_m/chat" method="post"><button>send</button></form>',
        '<section kovo-fragment-target="messages">OLD BUILD TRUTH</section>',
      ].join(''),
      '<meta name="kovo-build" content="build-old">',
    );
    const oldDocument = harness.window.document;
    const oldTarget = oldDocument.querySelector('[kovo-fragment-target="messages"]');
    const cancel = vi.fn(async () => undefined);
    const getReader = vi.fn(() => {
      throw new Error('untrusted build acquired a reader');
    });
    (harness.window as unknown as Record<string, unknown>).fetch = vi.fn(async () => ({
      body: { cancel, getReader },
      headers: responseHeaders(responseBuild),
      ok: true,
      status: 200,
    }));

    await installGeneratedInlineLoader(harness.window);
    oldDocument
      .querySelector('form')
      ?.dispatchEvent(
        new harness.window.SubmitEvent('submit', { bubbles: true, cancelable: true }),
      );

    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(getReader).not.toHaveBeenCalled();
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
        '<form enhance data-mutation-stream action="/_m/chat" method="post"><button>send</button></form>',
        '<section kovo-fragment-target="messages">AUTHORITATIVE</section>',
      ].join(''),
      '<meta name="kovo-build" content="build-a">',
    );
    const oldDocument = harness.window.document;
    const oldTarget = oldDocument.querySelector('[kovo-fragment-target="messages"]');
    let nativeSubmitCalls = 0;
    const form = oldDocument.querySelector<HTMLFormElement>('form');
    if (!form) throw new Error('missing stream form');
    form.submit = () => {
      nativeSubmitCalls += 1;
    };
    (harness.window as unknown as Record<string, unknown>).fetch = vi.fn(async () => ({
      body: frameStream(harness.window, [fragment, ...(terminator ? [terminator] : [])]),
      headers: responseHeaders('build-a'),
      ok: true,
      status: 200,
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

it('keeps complete same-build stream behavior without hard recovery', async () => {
  const harness = await createFrame(
    [
      '<form enhance data-mutation-stream action="/_m/chat" method="post"><button>send</button></form>',
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
    headers: responseHeaders('build-a'),
    ok: true,
    status: 200,
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
