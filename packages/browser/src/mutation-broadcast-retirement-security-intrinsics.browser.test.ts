import { afterEach, expect, it, vi } from 'vitest';

import { installMutationBroadcast } from './broadcast.js';
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';
import { createQueryStore } from './query-store.js';

const BUILD_TOKEN = 'build-c171';
const channels: BroadcastChannel[] = [];

afterEach(() => {
  for (const channel of channels.splice(0)) channel.close();
});

function installRetirementPoison(prototype: BroadcastChannel): {
  closeCalls(): number;
  nullSetterCalls(): number;
  restore(): void;
} {
  const onMessageDescriptor = Object.getOwnPropertyDescriptor(prototype, 'onmessage');
  if (!onMessageDescriptor?.set) throw new Error('BroadcastChannel.onmessage setter unavailable');
  const nativeOnMessageSet = onMessageDescriptor.set;
  const nativeClose = prototype.close;
  let closeCalls = 0;
  let nullSetterCalls = 0;
  Object.defineProperty(prototype, 'onmessage', {
    ...onMessageDescriptor,
    set(this: BroadcastChannel, value: ((event: MessageEvent<unknown>) => void) | null) {
      if (value === null) {
        nullSetterCalls += 1;
        return;
      }
      Reflect.apply(nativeOnMessageSet, this, [value]);
    },
  });
  prototype.close = function poisonedClose(): void {
    closeCalls += 1;
  };
  return {
    closeCalls: () => closeCalls,
    nullSetterCalls: () => nullSetterCalls,
    restore() {
      Object.defineProperty(prototype, 'onmessage', onMessageDescriptor);
      prototype.close = nativeClose;
    },
  };
}

it('retires modular receive through pinned controls after late clear and close poison', async () => {
  // C171 / SPEC §9.3: the closure-local retired bit cuts authority before
  // platform cleanup, and cleanup never consults the late-mutated prototype.
  const channelName = `kovo:c171:${crypto.randomUUID()}`;
  const senderChannel = new BroadcastChannel(channelName);
  const receiverChannel = new BroadcastChannel(channelName);
  channels.push(senderChannel, receiverChannel);
  const sender = installMutationBroadcast({
    buildToken: BUILD_TOKEN,
    channel: senderChannel,
    principal: 'session-A',
    store: createQueryStore(),
  });
  const receiverStore = createQueryStore();
  const receiver = installMutationBroadcast({
    buildToken: BUILD_TOKEN,
    channel: receiverChannel,
    principal: 'session-A',
    store: receiverStore,
  });

  sender.publish('<kovo-query name="account">{"secret":"READY"}</kovo-query>', [], BUILD_TOKEN);
  await vi.waitFor(() => expect(receiverStore.get('account')).toEqual({ secret: 'READY' }));
  receiverStore.delete('account');

  const poison = installRetirementPoison(BroadcastChannel.prototype);
  try {
    receiver.close();
  } finally {
    poison.restore();
  }
  expect(poison.nullSetterCalls()).toBe(0);
  expect(poison.closeCalls()).toBe(0);
  const onMessageDescriptor = Object.getOwnPropertyDescriptor(
    BroadcastChannel.prototype,
    'onmessage',
  );
  if (!onMessageDescriptor?.get) throw new Error('BroadcastChannel.onmessage getter unavailable');
  expect(Reflect.apply(onMessageDescriptor.get, receiverChannel, [])).toBeNull();

  sender.publish(
    '<kovo-query name="account">{"secret":"AFTER RETIREMENT"}</kovo-query>',
    [],
    BUILD_TOKEN,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(receiverStore.get('account')).toBeUndefined();
});

it('does not install an async subscription after synchronous retirement', async () => {
  const controls = createBrowserNavigationSecurityControls();
  const channel = controls.createMutationBroadcastChannel(`kovo:c171-race:${crypto.randomUUID()}`);
  if (!channel) throw new Error('BroadcastChannel unavailable');
  channels.push(channel);
  let retired = false;
  const subscription = controls.setMutationBroadcastMessageHandler(channel, vi.fn(), () => retired);

  retired = true;
  controls.retireMutationBroadcastChannel(channel);
  await subscription;

  const onMessageDescriptor = Object.getOwnPropertyDescriptor(
    BroadcastChannel.prototype,
    'onmessage',
  );
  if (!onMessageDescriptor?.get) throw new Error('BroadcastChannel.onmessage getter unavailable');
  expect(Reflect.apply(onMessageDescriptor.get, channel, [])).toBeNull();
});

it('fails closed when close was a no-op before the boot witness', async () => {
  const nativeClose = BroadcastChannel.prototype.close;
  let controls: ReturnType<typeof createBrowserNavigationSecurityControls>;
  BroadcastChannel.prototype.close = function poisonedClose(): void {};
  try {
    controls = createBrowserNavigationSecurityControls();
  } finally {
    BroadcastChannel.prototype.close = nativeClose;
  }
  const channel = new BroadcastChannel(`kovo:c171-preinit:${crypto.randomUUID()}`);
  channels.push(channel);

  await expect(controls.setMutationBroadcastMessageHandler(channel, vi.fn())).rejects.toThrow(
    /did not close its channel/,
  );
});
