import { afterEach, expect, it, vi } from 'vitest';

import { installMutationBroadcast, type BroadcastLike } from './broadcast.js';
import { inlineKovoLoaderInstallerSource } from './inline-loader.js';
import { createQueryStore } from './query-store.js';

const frames: HTMLIFrameElement[] = [];
const channels: BroadcastChannel[] = [];

afterEach(() => {
  for (const channel of channels.splice(0)) channel.close();
  for (const frame of frames.splice(0)) frame.remove();
});

function privateQueryBody(value: string): string {
  return `<kovo-query name="account">${JSON.stringify({ secret: value })}</kovo-query>`;
}

function fragmentBody(target: string, value: string): string {
  return [
    `<kovo-fragment target="${target}">`,
    `<section kovo-fragment-target="${target}">${value}</section>`,
    '</kovo-fragment>',
  ].join('');
}

function envelope(body: string, principal: string) {
  return {
    body,
    changes: [],
    principal,
    type: 'kovo:mutation-response',
  };
}

it('keeps the modular cross-principal discard pinned after late MessageEvent data poisoning', () => {
  // C137 / SPEC §9.3: the receiver must compare the principal from the
  // boot-read, immutable envelope that carries the original private wire.
  const descriptor = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data');
  if (!descriptor?.get) throw new Error('MessageEvent.data getter unavailable');
  const channel: BroadcastLike = {
    onmessage: null,
    postMessage() {},
  };
  const store = createQueryStore();
  installMutationBroadcast({ channel, principal: 'session-B', store });
  const privateEnvelope = envelope(privateQueryBody('SESSION-A PRIVATE'), 'session-A');
  const message = new MessageEvent('message', { data: privateEnvelope });

  channel.onmessage?.(message);
  expect(store.get('account')).toBeUndefined();

  let poisonCalls = 0;
  Object.defineProperty(MessageEvent.prototype, 'data', {
    ...descriptor,
    get(this: MessageEvent) {
      poisonCalls += 1;
      const original = Reflect.apply(descriptor.get!, this, []) as Record<string, unknown>;
      return { ...original, principal: 'session-B' };
    },
  });
  try {
    channel.onmessage?.(message);
  } finally {
    Object.defineProperty(MessageEvent.prototype, 'data', descriptor);
  }

  expect(poisonCalls).toBe(0);
  expect(store.get('account')).toBeUndefined();

  channel.onmessage?.(
    new MessageEvent('message', {
      data: envelope(privateQueryBody('SESSION-B CONTROL'), 'session-B'),
    }),
  );
  expect(store.get('account')).toEqual({ secret: 'SESSION-B CONTROL' });
});

it('keeps the generated inline cross-principal discard pinned after late MessageEvent data poisoning', async () => {
  // SPEC §5.2/§9.3: exercise the shipped generated artifact and prove an
  // ordered same-principal barrier still applies after the rejected private wire.
  const frame = document.createElement('iframe');
  frame.srcdoc = [
    '<!doctype html><html><head>',
    '<meta name="kovo-session" content="session-B">',
    '</head><body>',
    '<section kovo-fragment-target="private">INITIAL PRIVATE</section>',
    '<section kovo-fragment-target="barrier">INITIAL BARRIER</section>',
    '</body></html>',
  ].join('');
  frames.push(frame);
  const loaded = new Promise<void>((resolve) =>
    frame.addEventListener('load', () => resolve(), { once: true }),
  );
  document.body.append(frame);
  await loaded;

  const frameWindow = frame.contentWindow as Window & typeof globalThis;
  const frameDocument = frameWindow.document;
  const descriptor = Object.getOwnPropertyDescriptor(frameWindow.MessageEvent.prototype, 'data');
  if (!descriptor?.get) throw new Error('MessageEvent.data getter unavailable');
  (frameWindow as unknown as Record<string, unknown>).__kovoBroadcastPoisonImport =
    async () => ({});
  const script = frameDocument.createElement('script');
  script.textContent = `(${inlineKovoLoaderInstallerSource})(globalThis.__kovoBroadcastPoisonImport);`;
  frameDocument.head.append(script);
  const sender = new BroadcastChannel('kovo:mutation-response');
  channels.push(sender);

  sender.postMessage(envelope(fragmentBody('private', 'SESSION-A PRIVATE'), 'session-A'));
  sender.postMessage(envelope(fragmentBody('barrier', 'SAME-PRINCIPAL BARRIER'), 'session-B'));
  await vi.waitFor(() =>
    expect(frameDocument.querySelector('[kovo-fragment-target="barrier"]')?.textContent).toBe(
      'SAME-PRINCIPAL BARRIER',
    ),
  );
  expect(frameDocument.querySelector('[kovo-fragment-target="private"]')?.textContent).toBe(
    'INITIAL PRIVATE',
  );

  let poisonCalls = 0;
  Object.defineProperty(frameWindow.MessageEvent.prototype, 'data', {
    ...descriptor,
    get(this: MessageEvent) {
      poisonCalls += 1;
      const original = Reflect.apply(descriptor.get!, this, []) as Record<string, unknown>;
      return { ...original, principal: 'session-B' };
    },
  });
  try {
    sender.postMessage(envelope(fragmentBody('private', 'SESSION-A PRIVATE'), 'session-A'));
    sender.postMessage(
      envelope(fragmentBody('barrier', 'POST-POISON SAME-PRINCIPAL BARRIER'), 'session-B'),
    );
    await vi.waitFor(() =>
      expect(frameDocument.querySelector('[kovo-fragment-target="barrier"]')?.textContent).toBe(
        'POST-POISON SAME-PRINCIPAL BARRIER',
      ),
    );
  } finally {
    Object.defineProperty(frameWindow.MessageEvent.prototype, 'data', descriptor);
  }

  expect(poisonCalls).toBe(0);
  expect(frameDocument.querySelector('[kovo-fragment-target="private"]')?.textContent).toBe(
    'INITIAL PRIVATE',
  );
});
