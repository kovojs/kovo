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

function privateQueryBody(value: string): string {
  return `<kovo-query name="account">${JSON.stringify({ secret: value })}</kovo-query>`;
}

function fragmentBody(value: string): string {
  return [
    '<kovo-fragment target="private">',
    `<section kovo-fragment-target="private">${value}</section>`,
    '</kovo-fragment>',
  ].join('');
}

function stripPrincipalPostMessage(prototype: BroadcastChannel): {
  calls(): number;
  restore(): void;
} {
  const original = prototype.postMessage;
  let calls = 0;
  prototype.postMessage = function poisonedPostMessage(message: unknown): void {
    calls += 1;
    const forged = { ...(message as Record<string, unknown>) };
    delete forged.principal;
    Reflect.apply(original, this, [forged]);
  };
  return {
    calls: () => calls,
    restore() {
      prototype.postMessage = original;
    },
  };
}

it('keeps modular publish on the witnessed postMessage after late principal stripping poison', async () => {
  const channelName = `kovo:c151:${crypto.randomUUID()}`;
  const senderChannel = new BroadcastChannel(channelName);
  const anonymousChannel = new BroadcastChannel(channelName);
  const samePrincipalChannel = new BroadcastChannel(channelName);
  channels.push(senderChannel, anonymousChannel, samePrincipalChannel);
  const anonymousStore = createQueryStore();
  const samePrincipalStore = createQueryStore();
  const sender = installMutationBroadcast({
    channel: senderChannel,
    principal: 'session-A',
    store: createQueryStore(),
  });
  installMutationBroadcast({ channel: anonymousChannel, store: anonymousStore });
  installMutationBroadcast({
    channel: samePrincipalChannel,
    principal: 'session-A',
    store: samePrincipalStore,
  });

  sender.publish(privateQueryBody('BASELINE SESSION-A PRIVATE'));
  await vi.waitFor(() =>
    expect(samePrincipalStore.get('account')).toEqual({
      secret: 'BASELINE SESSION-A PRIVATE',
    }),
  );
  expect(anonymousStore.get('account')).toBeUndefined();

  const poison = stripPrincipalPostMessage(BroadcastChannel.prototype);
  try {
    sender.publish(privateQueryBody('PINNED SESSION-A PRIVATE'));
    await vi.waitFor(() =>
      expect(samePrincipalStore.get('account')).toEqual({
        secret: 'PINNED SESSION-A PRIVATE',
      }),
    );
  } finally {
    poison.restore();
  }
  expect(anonymousStore.get('account')).toBeUndefined();
  expect(poison.calls()).toBe(0);
});

it('keeps generated publish on the witnessed postMessage after late principal stripping poison', async () => {
  const senderFrame = document.createElement('iframe');
  senderFrame.srcdoc = [
    '<!doctype html><html><head><meta name="kovo-session" content="session-A"></head><body>',
    '<form enhance action="/_m/private" method="post"><button>send</button></form>',
    '<section kovo-fragment-target="private">SENDER INITIAL</section>',
    '</body></html>',
  ].join('');
  const anonymousFrame = document.createElement('iframe');
  anonymousFrame.srcdoc = [
    '<!doctype html><html><head></head><body>',
    '<section kovo-fragment-target="private">ANONYMOUS INITIAL</section>',
    '</body></html>',
  ].join('');
  const samePrincipalFrame = document.createElement('iframe');
  samePrincipalFrame.srcdoc = [
    '<!doctype html><html><head><meta name="kovo-session" content="session-A"></head><body>',
    '<section kovo-fragment-target="private">SESSION-A INITIAL</section>',
    '</body></html>',
  ].join('');
  frames.push(senderFrame, anonymousFrame, samePrincipalFrame);
  const loaded = [senderFrame, anonymousFrame, samePrincipalFrame].map(
    (frame) =>
      new Promise<void>((resolve) =>
        frame.addEventListener('load', () => resolve(), { once: true }),
      ),
  );
  document.body.append(senderFrame, anonymousFrame, samePrincipalFrame);
  await Promise.all(loaded);

  const senderWindow = senderFrame.contentWindow as Window & typeof globalThis;
  const anonymousWindow = anonymousFrame.contentWindow as Window & typeof globalThis;
  const samePrincipalWindow = samePrincipalFrame.contentWindow as Window & typeof globalThis;
  const senderDocument = senderWindow.document;
  const anonymousDocument = anonymousWindow.document;
  const samePrincipalDocument = samePrincipalWindow.document;
  let responseValue = 'BASELINE SESSION-A PRIVATE';
  (senderWindow as unknown as Record<string, unknown>).fetch = vi.fn(
    async () => new senderWindow.Response(fragmentBody(responseValue), { status: 200 }),
  );
  for (const frameWindow of [senderWindow, anonymousWindow, samePrincipalWindow]) {
    (frameWindow as unknown as Record<string, unknown>).__kovoC151Import = async () => ({});
    const script = frameWindow.document.createElement('script');
    script.textContent = `(${inlineKovoLoaderInstallerSource})(globalThis.__kovoC151Import);`;
    frameWindow.document.head.append(script);
  }
  const form = senderDocument.querySelector('form');
  if (!form) throw new Error('sender form unavailable');

  form.dispatchEvent(new senderWindow.SubmitEvent('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(
      samePrincipalDocument.querySelector('[kovo-fragment-target="private"]')?.textContent,
    ).toBe('BASELINE SESSION-A PRIVATE'),
  );
  expect(anonymousDocument.querySelector('[kovo-fragment-target="private"]')?.textContent).toBe(
    'ANONYMOUS INITIAL',
  );

  responseValue = 'PINNED SESSION-A PRIVATE';
  const poison = stripPrincipalPostMessage(senderWindow.BroadcastChannel.prototype);
  try {
    form.dispatchEvent(new senderWindow.SubmitEvent('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(
        samePrincipalDocument.querySelector('[kovo-fragment-target="private"]')?.textContent,
      ).toBe('PINNED SESSION-A PRIVATE'),
    );
  } finally {
    poison.restore();
  }
  expect(anonymousDocument.querySelector('[kovo-fragment-target="private"]')?.textContent).toBe(
    'ANONYMOUS INITIAL',
  );
  expect(poison.calls()).toBe(0);
});
