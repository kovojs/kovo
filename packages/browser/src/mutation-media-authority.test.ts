import { describe, expect, it, vi } from 'vitest';

import { fetchEnhancedMutation } from './mutation-fetch.js';
import { inlineSourceInstallCases } from './inline-loader-test-utils.js';
import { serverStampedMutationIdem } from './runtime-test-fakes.js';

describe('enhanced mutation media authority', () => {
  it('rejects a session directive outside the exact mutation media envelope', async () => {
    const retire = vi.fn();
    const reload = vi.fn();
    const pending = fetchEnhancedMutation({
      fetch: async () => ({
        headers: {
          get(name: string) {
            const normalized = name.toLowerCase();
            if (normalized === 'content-type') return 'text/html; charset=utf-8';
            if (normalized === 'kovo-session-transition') return 'reload';
            return null;
          },
        },
        ok: true,
        status: 200,
        text: async () => '<html>ordinary document</html>',
        url: 'http://localhost/_m/account/update',
      }),
      form: {
        action: '/_m/account/update',
        getAttribute(name: string) {
          if (name === 'data-mutation') return 'account/update';
          if (name === 'enhance') return '';
          return null;
        },
        method: 'post',
      },
      formData: new FormData(),
      onSessionTransition: retire,
      onSessionTransitionReload: reload,
      root: { querySelectorAll: () => [] },
    });

    await expect(pending).rejects.toThrow(/non-fragment enhanced mutation response/u);
    expect(retire).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it.each(inlineSourceInstallCases)(
    'does not consume an inline session directive outside mutation media through %s',
    async (_name, installSource) => {
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        BroadcastChannel: globalRecord.BroadcastChannel,
        FormData: globalRecord.FormData,
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        fetch: globalRecord.fetch,
        importModule: globalRecord.__kovoInlineImport,
        location: globalRecord.location,
      };
      const listeners = new Map<string, (event: unknown) => void>();
      const closeBroadcast = vi.fn();
      const reload = vi.fn();
      const preventDefault = vi.fn();
      const form = {
        action: '/_m/account/update',
        getAttribute(name: string) {
          if (name === 'action') return '/_m/account/update';
          if (name === 'data-mutation') return 'account/update';
          if (name === 'method') return 'post';
          return null;
        },
        method: 'post',
      };

      try {
        globalRecord.BroadcastChannel = class BroadcastChannel {
          onmessage: ((event: unknown) => void) | null = null;

          close() {
            closeBroadcast();
          }

          postMessage() {}
        };
        globalRecord.FormData = function FormData() {
          const values = new Map<string, unknown>([['Kovo-Idem', serverStampedMutationIdem]]);
          return {
            get(name: string) {
              return values.get(name) ?? null;
            },
            set(name: string, value: unknown) {
              values.set(name, value);
            },
          };
        };
        globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
          listeners.set(type, listener);
        };
        globalRecord.document = {
          querySelector(selector: string) {
            return selector === 'meta[name="kovo-build"]'
              ? { getAttribute: (name: string) => (name === 'content' ? 'build-proof' : null) }
              : null;
          },
          querySelectorAll: () => [],
        };
        const fetch = vi.fn(async () => ({
          headers: {
            get(name: string) {
              const normalized = name.toLowerCase();
              if (normalized === 'content-type') return 'text/html; charset=utf-8';
              if (normalized === 'kovo-session-transition') return 'reload';
              return null;
            },
          },
          ok: true,
          status: 200,
          text: async () => '<html>ordinary document</html>',
          url: 'https://kovo.test/_m/account/update',
        }));
        globalRecord.fetch = fetch;
        globalRecord.location = {
          hash: '',
          href: 'https://kovo.test/account',
          origin: 'https://kovo.test',
          pathname: '/account',
          protocol: 'https:',
          reload,
          search: '',
        };

        installSource(
          vi.fn(async () => ({})),
          globalRecord,
        );
        listeners.get('submit')?.({
          preventDefault,
          target: { closest: () => form },
          type: 'submit',
        });
        await Promise.resolve();
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(preventDefault).toHaveBeenCalledOnce();
        expect(fetch).toHaveBeenCalledOnce();
        // SPEC §9.1: pinned response-header controls may snapshot the allowlisted header bag,
        // but the session directive must not gain semantic authority or retire the page principal
        // outside exact mutation media. The reload here is only the ordinary source-document GET
        // recovery after an ambiguous dispatched mutation.
        expect(closeBroadcast).not.toHaveBeenCalled();
        expect(reload).toHaveBeenCalledOnce();
      } finally {
        Object.assign(globalRecord, {
          BroadcastChannel: originals.BroadcastChannel,
          FormData: originals.FormData,
          addEventListener: originals.addEventListener,
          document: originals.document,
          fetch: originals.fetch,
          location: originals.location,
        });
        if (originals.importModule === undefined) delete globalRecord.__kovoInlineImport;
        else globalRecord.__kovoInlineImport = originals.importModule;
      }
    },
  );
});
