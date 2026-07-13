import { afterEach, describe, expect, it, vi } from 'vitest';

describe('session-transition reload security', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('uses the boot-pinned reload after late substitution and retires the principal first', async () => {
    let closed = false;
    const reload = vi.fn(() => {
      expect(closed).toBe(true);
    });
    const poison = vi.fn();
    const location = {
      assign: vi.fn(),
      hash: '',
      href: 'https://kovo.test/private',
      origin: 'https://kovo.test',
      pathname: '/private',
      reload,
      search: '',
    };
    vi.stubGlobal('location', location);
    const { retireSessionTransitionRuntime } = await import('./session-transition.js');
    location.reload = poison;

    retireSessionTransitionRuntime({
      broadcast: {
        close() {
          closed = true;
        },
        publish() {},
      },
    });

    expect(reload).toHaveBeenCalledOnce();
    expect(poison).not.toHaveBeenCalled();
  });

  it('uses the same boot-pinned reload after an unconfirmed progressive stream', async () => {
    const reload = vi.fn();
    const poison = vi.fn();
    const location = {
      assign: vi.fn(),
      hash: '',
      href: 'https://kovo.test/chat',
      origin: 'https://kovo.test',
      pathname: '/chat',
      reload,
      search: '',
    };
    vi.stubGlobal('location', location);
    const [{ applyStreamingMutationResponseBodyToRuntime }, { createQueryStore }, runtimeFakes] =
      await Promise.all([
        import('./apply-mutation-response.js'),
        import('./query-store.js'),
        import('./runtime-test-fakes.js'),
      ]);
    location.reload = poison;
    const root = new runtimeFakes.FakeMorphRoot();
    const target = new runtimeFakes.FakeMorphTarget();
    root.targets.set('messages', target);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            '<kovo-fragment target="messages"><article>UNCONFIRMED</article></kovo-fragment>' +
              '<kovo-done reason="error"></kovo-done>',
          ),
        );
        controller.close();
      },
    });

    await expect(
      applyStreamingMutationResponseBodyToRuntime({ body, root, store: createQueryStore() }),
    ).rejects.toThrow(/not confirmed/);
    expect(target.html).toContain('UNCONFIRMED');
    expect(reload).toHaveBeenCalledOnce();
    expect(poison).not.toHaveBeenCalled();
  });
});
