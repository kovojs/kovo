import { afterEach, expect, it, vi } from 'vitest';

import { installMutationBroadcast } from './broadcast.js';
import { inlineKovoLoaderInstallerSource } from './inline-loader.js';
import { createQueryStore } from './query-store.js';

const frames: HTMLIFrameElement[] = [];
const channels: BroadcastChannel[] = [];

afterEach(() => {
  for (const channel of channels.splice(0)) channel.close();
  for (const frame of frames.splice(0)) frame.remove();
});

function installPrincipalStrippingOnMessage(
  channelPrototype: BroadcastChannel,
  MessageEventConstructor: typeof MessageEvent,
): { handlerSetterCalls(): number; messageCalls(): number; restore(): void } {
  const descriptor = Object.getOwnPropertyDescriptor(channelPrototype, 'onmessage');
  const dataDescriptor = Object.getOwnPropertyDescriptor(MessageEventConstructor.prototype, 'data');
  if (!descriptor?.set || !dataDescriptor?.get) throw new Error('message controls unavailable');
  const nativeSet = descriptor.set;
  const nativeData = dataDescriptor.get;
  let messageCalls = 0;
  let handlerSetterCalls = 0;
  Object.defineProperty(channelPrototype, 'onmessage', {
    ...descriptor,
    set(this: BroadcastChannel, value: ((event: MessageEvent<unknown>) => void) | null) {
      if (typeof value !== 'function') {
        Reflect.apply(nativeSet, this, [value]);
        return;
      }
      handlerSetterCalls += 1;
      const wrapped = (event: MessageEvent<unknown>) => {
        messageCalls += 1;
        const original = Reflect.apply(nativeData, event, []) as Record<string, unknown>;
        const forged = { ...original };
        delete forged.principal;
        Reflect.apply(value, this, [new MessageEventConstructor('message', { data: forged })]);
      };
      Reflect.apply(nativeSet, this, [wrapped]);
    },
  });
  return {
    handlerSetterCalls: () => handlerSetterCalls,
    messageCalls: () => messageCalls,
    restore() {
      Object.defineProperty(channelPrototype, 'onmessage', descriptor);
    },
  };
}

it('installs modular receive through the witnessed setter after late interposition', async () => {
  const channelName = `kovo:c164:${crypto.randomUUID()}`;
  const senderChannel = new BroadcastChannel(channelName);
  const anonymousChannel = new BroadcastChannel(channelName);
  const samePrincipalChannel = new BroadcastChannel(channelName);
  channels.push(senderChannel, anonymousChannel, samePrincipalChannel);
  const sender = installMutationBroadcast({
    channel: senderChannel,
    principal: 'session-A',
    store: createQueryStore(),
  });
  const anonymousStore = createQueryStore();
  const samePrincipalStore = createQueryStore();

  const poison = installPrincipalStrippingOnMessage(BroadcastChannel.prototype, MessageEvent);
  try {
    installMutationBroadcast({ channel: anonymousChannel, store: anonymousStore });
    installMutationBroadcast({
      channel: samePrincipalChannel,
      principal: 'session-A',
      store: samePrincipalStore,
    });
  } finally {
    poison.restore();
  }
  sender.publish('<kovo-query name="account">{"secret":"SESSION A"}</kovo-query>');
  await vi.waitFor(() =>
    expect(samePrincipalStore.get('account')).toEqual({ secret: 'SESSION A' }),
  );
  expect(anonymousStore.get('account')).toBeUndefined();
  expect(poison.handlerSetterCalls()).toBe(0);
  expect(poison.messageCalls()).toBe(0);
});

it('never installs generated receive when the pre-init setter fails its witness', async () => {
  const frame = document.createElement('iframe');
  frame.srcdoc = [
    '<!doctype html><html><head></head><body>',
    '<section kovo-fragment-target="private">ANONYMOUS INITIAL</section>',
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
  (frameWindow as unknown as Record<string, unknown>).__kovoC164Import = async () => ({});
  const poison = installPrincipalStrippingOnMessage(
    frameWindow.BroadcastChannel.prototype,
    frameWindow.MessageEvent,
  );
  try {
    const script = frameDocument.createElement('script');
    script.textContent = `(${inlineKovoLoaderInstallerSource})(globalThis.__kovoC164Import);`;
    frameDocument.head.append(script);
  } finally {
    poison.restore();
  }
  const witnessSetterCalls = poison.handlerSetterCalls();
  expect(witnessSetterCalls).toBeGreaterThan(0);

  const sender = new BroadcastChannel('kovo:mutation-response');
  channels.push(sender);
  await new Promise((resolve) => setTimeout(resolve, 50));
  sender.postMessage({
    body: [
      '<kovo-fragment target="private">',
      '<section kovo-fragment-target="private">SESSION A PRIVATE</section>',
      '</kovo-fragment>',
    ].join(''),
    changes: [],
    principal: 'session-A',
    type: 'kovo:mutation-response',
  });

  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(frameDocument.querySelector('[kovo-fragment-target="private"]')?.textContent).toBe(
    'ANONYMOUS INITIAL',
  );
  // Only boot witnesses reached the poisoned setter. The getter/setter identity
  // witness rejected before dispatch, and the application handler stayed behind
  // the rejected controls-ready promise.
  expect(poison.handlerSetterCalls()).toBe(witnessSetterCalls);
});
