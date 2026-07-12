import { afterEach, describe, expect, it, vi } from 'vitest';

import { inlineSourceInstallCases, type InlineSourceInstall } from './inline-loader-test-utils.js';

type StreamHarness = {
  append: ReturnType<typeof vi.fn>;
  formSubmit: ReturnType<typeof vi.fn>;
  listeners: Map<string, (event: unknown) => void>;
  reload: ReturnType<typeof vi.fn>;
};

function streamOf(parts: readonly string[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      const part = parts[index++];
      if (part === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(new TextEncoder().encode(part));
    },
  });
}

async function installStreamHarness(
  installSource: InlineSourceInstall,
  response: unknown,
  pageBuild = 'build-a',
  onReload?: () => void,
): Promise<StreamHarness> {
  const globalRecord = globalThis as unknown as Record<string, unknown>;
  const listeners = new Map<string, (event: unknown) => void>();
  const append = vi.fn();
  const formSubmit = vi.fn();
  const reload = vi.fn(async () => onReload?.());
  const target = {
    append,
    children: [],
    querySelectorAll() {
      return [];
    },
  };
  const form = {
    action: '/_m/chat',
    getAttribute(name: string) {
      if (name === 'data-mutation-stream' || name === 'enhance') return '';
      return null;
    },
    method: 'post',
    submit: formSubmit,
  };

  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('FormData', function FormData() {
    return { get: () => null };
  });
  vi.stubGlobal('addEventListener', (type: string, listener: (event: unknown) => void) => {
    listeners.set(type, listener);
  });
  vi.stubGlobal('dispatchEvent', vi.fn());
  vi.stubGlobal('document', {
    activeElement: null,
    body: {},
    createElement(name: string) {
      if (name !== 'template') throw new Error(`unexpected element: ${name}`);
      const content: { childNodes: unknown[]; children: unknown[] } = {
        childNodes: [],
        children: [],
      };
      return {
        content,
        set innerHTML(html: string) {
          const node = {
            attributes: [],
            outerHTML: html,
            querySelectorAll() {
              return [];
            },
          };
          content.childNodes = [node];
          content.children = [node];
        },
      };
    },
    getElementById() {
      return null;
    },
    querySelector(selector: string) {
      if (selector === 'meta[name="kovo-build"]') {
        return { getAttribute: () => pageBuild };
      }
      if (selector === '[kovo-fragment-target="messages"]') return target;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response),
  );
  vi.stubGlobal('history', {});
  vi.stubGlobal('location', {
    hash: '',
    href: 'https://kovo.test/chat',
    origin: 'https://kovo.test',
    pathname: '/chat',
    reload,
    search: '',
  });
  vi.stubGlobal('requestAnimationFrame', undefined);

  installSource(async () => ({}), globalRecord);
  listeners.get('submit')?.({
    preventDefault() {},
    target: {
      closest(selector: string) {
        return selector === 'form[enhance],form[data-enhance],form[data-mutation]' ? form : null;
      },
    },
    type: 'submit',
  });

  return { append, formSubmit, listeners, reload };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('inline streaming recovery invariants', () => {
  it.each(inlineSourceInstallCases)(
    'cancels missing and foreign-build bodies before getReader and hard-recovers through %s',
    async (_name, installSource) => {
      for (const responseBuild of [undefined, 'build-b']) {
        const order: string[] = [];
        const cancel = vi.fn(async () => {
          order.push('cancel');
        });
        const body = new ReadableStream<Uint8Array>({ cancel });
        const response = {
          body,
          headers: {
            get(name: string) {
              return name.toLowerCase() === 'kovo-build' ? (responseBuild ?? null) : null;
            },
          },
          ok: true,
          status: 200,
        };

        const harness = await installStreamHarness(installSource, response, 'build-a', () => {
          order.push('reload');
        });

        await vi.waitFor(() => expect(harness.reload).toHaveBeenCalledTimes(1));
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(body.locked).toBe(false);
        expect(harness.append).not.toHaveBeenCalled();
        expect(harness.formSubmit).not.toHaveBeenCalled();
        expect(order).toEqual(['cancel', 'reload']);
      }
    },
  );

  it.each(inlineSourceInstallCases)(
    'hard-recovers error, aborted, and missing-done streams without generic form fallback through %s',
    async (_name, installSource) => {
      for (const terminator of [
        '<kovo-done reason="error"></kovo-done>',
        '<kovo-done reason="aborted"></kovo-done>',
        '',
      ]) {
        const response = {
          body: streamOf([
            '<kovo-fragment target="messages" mode="append"><article>UNCONFIRMED</article></kovo-fragment>',
            ...(terminator ? [terminator] : []),
          ]),
          headers: { get: (name: string) => (name === 'Kovo-Build' ? 'build-a' : null) },
          ok: true,
          status: 200,
        };
        const harness = await installStreamHarness(installSource, response);

        await vi.waitFor(() => expect(harness.reload).toHaveBeenCalledTimes(1));
        expect(harness.append).toHaveBeenCalledTimes(1);
        expect(harness.formSubmit).not.toHaveBeenCalled();
      }
    },
  );

  it.each(inlineSourceInstallCases)(
    'keeps a complete same-build stream without recovery through %s',
    async (_name, installSource) => {
      const response = {
        body: streamOf([
          '<kovo-fragment target="messages" mode="append"><article>CONFIRMED</article></kovo-fragment>',
          '<kovo-done reason="complete"></kovo-done>',
        ]),
        headers: { get: (name: string) => (name === 'Kovo-Build' ? 'build-a' : null) },
        ok: true,
        status: 200,
      };
      const harness = await installStreamHarness(installSource, response);

      await vi.waitFor(() => expect(harness.append).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(harness.reload).not.toHaveBeenCalled();
      expect(harness.formSubmit).not.toHaveBeenCalled();
    },
  );
});
