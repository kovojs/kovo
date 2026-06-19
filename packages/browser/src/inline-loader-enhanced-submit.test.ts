import { describe, expect, it, vi } from 'vitest';

import { createQueryStore, type EnhancedMutationFetchOptions } from './client.js';
import { submitEnhancedMutation } from './mutation-submit.js';
import { inlineSourceInstallCases, InlineParityRoot } from './inline-loader-test-utils.js';

describe('inline loader enhanced submit source', () => {
  it.each(inlineSourceInstallCases)(
    'stamps inline enhanced forms when fetch fails without native submit through %s',
    async (_name, installSource) => {
      // SPEC.md §4.4: inline enhanced-form failure handling must not fall back to native submit.
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        FormData: globalRecord.FormData,
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        fetch: globalRecord.fetch,
        importModule: globalRecord.__kovoInlineImport,
      };
      const listeners = new Map<string, (event: unknown) => void>();
      const attributes = new Map<string, string>();
      const form = {
        action: '/_m/cart/add',
        getAttribute(name: string) {
          return name === 'data-enhance' ? '' : null;
        },
        method: 'post',
        setAttribute(name: string, value: string) {
          attributes.set(name, value);
        },
      };

      try {
        globalRecord.FormData = function FormData() {
          return {};
        };
        globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
          listeners.set(type, listener);
        };
        globalRecord.document = {
          querySelectorAll(selector: string) {
            return selector === '[kovo-deps]' ? [] : [];
          },
        };
        globalRecord.fetch = vi.fn(async () => {
          throw new Error('network down');
        });

        installSource(
          vi.fn(async () => ({})),
          globalRecord,
        );
        listeners.get('submit')?.({
          preventDefault: vi.fn(),
          target: {
            closest(selector: string) {
              return selector === 'form[enhance],form[data-enhance],form[data-mutation]'
                ? form
                : null;
            },
          },
          type: 'submit',
        });
        await Promise.resolve();
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(attributes).toEqual(
          new Map([
            ['data-error-code', 'NETWORK_ERROR'],
            ['kovo-error', ''],
          ]),
        );
      } finally {
        Object.assign(globalRecord, {
          FormData: originals.FormData,
          addEventListener: originals.addEventListener,
          document: originals.document,
          fetch: originals.fetch,
        });
        if (originals.importModule === undefined) {
          delete globalRecord.__kovoInlineImport;
        } else {
          globalRecord.__kovoInlineImport = originals.importModule;
        }
      }
    },
  );

  it.each(inlineSourceInstallCases)(
    'ignores non-enhanced submit candidates through %s',
    async (_name, installSource) => {
      // SPEC.md §4.4: the inline bootstrap follows the modular enhanced-form gate.
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        fetch: globalRecord.fetch,
        importModule: globalRecord.__kovoInlineImport,
      };
      const listeners = new Map<string, (event: unknown) => void>();
      const preventDefault = vi.fn();
      const fetch = vi.fn();

      try {
        globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
          listeners.set(type, listener);
        };
        globalRecord.document = {
          querySelectorAll() {
            return [];
          },
        };
        globalRecord.fetch = fetch;

        installSource(
          vi.fn(async () => ({})),
          globalRecord,
        );
        listeners.get('submit')?.({
          preventDefault,
          target: {
            closest(selector: string) {
              return selector === 'form[enhance],form[data-enhance],form[data-mutation]'
                ? null
                : {
                    action: '/plain',
                    getAttribute() {
                      return null;
                    },
                    method: 'post',
                  };
            },
          },
          type: 'submit',
        });
        await Promise.resolve();

        expect(preventDefault).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        Object.assign(globalRecord, {
          addEventListener: originals.addEventListener,
          document: originals.document,
          fetch: originals.fetch,
        });
        if (originals.importModule === undefined) {
          delete globalRecord.__kovoInlineImport;
        } else {
          globalRecord.__kovoInlineImport = originals.importModule;
        }
      }
    },
  );

  it.each(inlineSourceInstallCases)(
    'keeps enhanced form request targets in parity with modular submit through %s',
    async (_name, installSource) => {
      // SPEC.md §4.4: enhanced form headers are part of the always-loaded loader contract.
      const formData = { kind: 'form-data' };
      const form = {
        action: '/_m/cart/add',
        getAttribute(name: string) {
          if (name === 'id') return 'your-answer';
          return name === 'enhance' ? '' : null;
        },
        id: { toString: () => '[object HTMLInputElement]' },
        method: 'post',
      };
      const targetDeps = [
        { deps: 'cart', id: 'cart-badge' },
        { deps: 'cart', id: 'cart-badge' },
        {
          component: 'components/inventory/inventory',
          deps: 'inventory, stock',
          id: 'inventory-panel',
          props: '{"warehouseId":"w1"}',
          target: 'inventory',
        },
        { deps: 'debug', id: 'empty-fragment-target-fallback', target: '' },
        { deps: '', id: 'standalone-target' },
        { component: 'cart-summary', deps: 'cart summary', id: 'cart-summary' },
      ];
      const modularRoot = new InlineParityRoot();
      const modularFetch = vi.fn(async (_url: string, _options: EnhancedMutationFetchOptions) => ({
        headers: {
          get() {
            return null;
          },
        },
        async text() {
          return '';
        },
      }));
      modularRoot.deps = targetDeps;

      await submitEnhancedMutation({
        fetch: modularFetch,
        form,
        formData,
        idem: 'idem_form_parity',
        root: modularRoot,
        store: createQueryStore(),
      });

      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
      const originals = {
        DOMParser: globalRecord.DOMParser,
        FormData: globalRecord.FormData,
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        fetch: globalRecord.fetch,
        importModule: globalRecord.__kovoInlineImport,
      };
      const listeners = new Map<string, (event: unknown) => void>();
      const preventDefault = vi.fn();
      const inlineFetch = vi.fn(async (_url: string, _options: EnhancedMutationFetchOptions) => ({
        async text() {
          return '';
        },
      }));

      try {
        Object.defineProperty(globalThis, 'crypto', {
          configurable: true,
          value: { randomUUID: () => 'idem_form_parity' },
        });
        globalRecord.DOMParser = class DOMParser {
          parseFromString() {
            throw new Error('inline mutation response parsing must not use DOMParser');
          }
        };
        globalRecord.FormData = function FormData() {
          return formData;
        };
        globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
          listeners.set(type, listener);
        };
        globalRecord.document = {
          getElementById() {
            return null;
          },
          querySelector() {
            return null;
          },
          querySelectorAll(selector: string) {
            if (selector !== '[kovo-deps]') return [];
            return targetDeps.map((dep) => ({
              getAttribute(name: string) {
                if (name === 'kovo-deps') return dep.deps;
                if (name === 'kovo-fragment-target') return dep.target ?? null;
                if (name === 'kovo-live-component') return dep.component ?? null;
                if (name === 'kovo-props') return dep.props ?? null;
                if (name === 'kovo-c') return null;
                if (name === 'id') return dep.id ?? null;
                return null;
              },
              id: dep.id,
            }));
          },
        };
        globalRecord.fetch = inlineFetch;

        installSource(
          vi.fn(async () => ({})),
          globalRecord,
        );
        listeners.get('submit')?.({
          preventDefault,
          target: {
            closest(selector: string) {
              return selector === 'form[enhance],form[data-enhance],form[data-mutation]'
                ? form
                : null;
            },
          },
          type: 'submit',
        });
        await Promise.resolve();
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(preventDefault).toHaveBeenCalledTimes(1);
        const inlineRequest = inlineFetch.mock.calls[0];
        expect(inlineRequest).toEqual(modularFetch.mock.calls[0]);
        expect(inlineRequest?.[1].headers['Kovo-Targets']).toBe(
          'cart-badge=cart; inventory=inventory stock; standalone-target; cart-summary=cart summary',
        );
        expect(inlineRequest?.[1].headers['Kovo-Live-Targets']).toBe(
          'cart-badge#cart-badge:{}; inventory#components/inventory/inventory:{"warehouseId":"w1"}; standalone-target#standalone-target:{}; cart-summary#cart-summary:{}',
        );
        expect(inlineRequest?.[1].headers['Kovo-Form-Target']).toBe('your-answer');
      } finally {
        Object.assign(globalRecord, {
          DOMParser: originals.DOMParser,
          FormData: originals.FormData,
          addEventListener: originals.addEventListener,
          document: originals.document,
          fetch: originals.fetch,
        });
        if (originals.importModule === undefined) {
          delete globalRecord.__kovoInlineImport;
        } else {
          globalRecord.__kovoInlineImport = originals.importModule;
        }
        if (cryptoDescriptor) {
          Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
        } else {
          delete (globalThis as unknown as { crypto?: unknown }).crypto;
        }
      }
    },
  );

  it.each(inlineSourceInstallCases)(
    'includes the clicked submitter in inline enhanced form data through %s',
    async (_name, installSource) => {
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        FormData: globalRecord.FormData,
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        fetch: globalRecord.fetch,
        importModule: globalRecord.__kovoInlineImport,
      };
      const listeners = new Map<string, (event: unknown) => void>();
      const constructedArgs: unknown[][] = [];
      const formData = { kind: 'submitter-aware-form-data' };
      const form = {
        action: '/_m/cart/add',
        getAttribute(name: string) {
          return name === 'enhance' ? '' : null;
        },
        method: 'post',
      };
      const submitter = { name: 'intent', value: 'preview' };
      const inlineFetch = vi.fn(async () => ({
        async text() {
          return '';
        },
      }));

      try {
        globalRecord.FormData = function FormData(...args: unknown[]) {
          constructedArgs.push(args);
          return formData;
        };
        globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
          listeners.set(type, listener);
        };
        globalRecord.document = {
          getElementById() {
            return null;
          },
          querySelector() {
            return null;
          },
          querySelectorAll() {
            return [];
          },
        };
        globalRecord.fetch = inlineFetch;

        installSource(
          vi.fn(async () => ({})),
          globalRecord,
        );
        listeners.get('submit')?.({
          preventDefault: vi.fn(),
          submitter,
          target: {
            closest(selector: string) {
              return selector === 'form[enhance],form[data-enhance],form[data-mutation]'
                ? form
                : null;
            },
          },
          type: 'submit',
        });
        await Promise.resolve();
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(constructedArgs).toEqual([[form, submitter]]);
        expect(inlineFetch).toHaveBeenCalledWith(
          '/_m/cart/add',
          expect.objectContaining({ body: formData }),
        );
      } finally {
        Object.assign(globalRecord, {
          FormData: originals.FormData,
          addEventListener: originals.addEventListener,
          document: originals.document,
          fetch: originals.fetch,
        });
        if (originals.importModule === undefined) {
          delete globalRecord.__kovoInlineImport;
        } else {
          globalRecord.__kovoInlineImport = originals.importModule;
        }
      }
    },
  );

  it.each(inlineSourceInstallCases)(
    'streams inline enhanced mutation text through %s',
    async (_name, installSource) => {
      // SPEC.md §4.4/§9.1: the always-loaded submit path must request and
      // incrementally apply streaming mutation text for compiler-marked forms.
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        FormData: globalRecord.FormData,
        TextDecoder: globalRecord.TextDecoder,
        TextEncoder: globalRecord.TextEncoder,
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        dispatchEvent: globalRecord.dispatchEvent,
        fetch: globalRecord.fetch,
        importModule: globalRecord.__kovoInlineImport,
      };
      const listeners = new Map<string, (event: unknown) => void>();
      const formData = { kind: 'stream-form-data' };
      const streamTargetAttrs = new Map<string, string>([
        ['data-stream-renderer', '/client.ts#renderMarkdownStream'],
      ]);
      const streamTarget = {
        textContent: '',
        getAttribute(name: string) {
          return streamTargetAttrs.get(name) ?? null;
        },
        setAttribute(name: string, value: string) {
          streamTargetAttrs.set(name, value);
        },
      };
      const form = {
        action: '/_m/chat/send',
        getAttribute(name: string) {
          if (name === 'data-mutation-stream') return 'true';
          if (name === 'kovo-fragment-target') return 'composer';
          return null;
        },
        method: 'post',
      };
      const importModule = vi.fn(async () => ({
        renderMarkdownStream(target: typeof streamTarget, source: string) {
          target.setAttribute('data-rendered-markdown', source.includes('|') ? 'table' : 'plain');
        },
      }));
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode('<kovo-text target="assistant:a1">Hello &lt;em&gt;</kovo-text>'),
          );
          controller.enqueue(
            encoder.encode(
              '<kovo-text target="assistant:a1" mode="checkpoint">| Final</kovo-text>',
            ),
          );
          controller.enqueue(encoder.encode('<kovo-done reason="error"></kovo-done>'));
          controller.close();
        },
      });
      const inlineFetch = vi.fn(async () => ({ body }));

      try {
        globalRecord.FormData = function FormData() {
          return formData;
        };
        globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
          listeners.set(type, listener);
        };
        globalRecord.dispatchEvent = vi.fn();
        globalRecord.document = {
          getElementById() {
            return null;
          },
          querySelector(selector: string) {
            return selector === '[data-stream-text="assistant:a1"]' ? streamTarget : null;
          },
          querySelectorAll() {
            return [];
          },
        };
        globalRecord.fetch = inlineFetch;

        installSource(importModule, globalRecord);
        listeners.get('submit')?.({
          preventDefault: vi.fn(),
          target: {
            closest(selector: string) {
              return selector === 'form[enhance],form[data-enhance],form[data-mutation]'
                ? form
                : null;
            },
          },
          type: 'submit',
        });

        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(inlineFetch).toHaveBeenCalledWith(
          '/_m/chat/send',
          expect.objectContaining({
            body: formData,
            headers: expect.objectContaining({
              Accept: 'text/vnd.kovo.fragment+html; stream=1',
              'Kovo-Stream': 'true',
            }),
            keepalive: false,
          }),
        );
        expect(streamTarget.textContent).toBe('| Final');
        expect(streamTargetAttrs.get('data-stream-state')).toBe('error');
        expect(streamTargetAttrs.get('data-rendered-markdown')).toBe('table');
        expect(importModule).toHaveBeenCalledWith('/client.ts');
      } finally {
        Object.assign(globalRecord, {
          FormData: originals.FormData,
          TextDecoder: originals.TextDecoder,
          TextEncoder: originals.TextEncoder,
          addEventListener: originals.addEventListener,
          document: originals.document,
          dispatchEvent: originals.dispatchEvent,
          fetch: originals.fetch,
        });
        if (originals.importModule === undefined) {
          delete globalRecord.__kovoInlineImport;
        } else {
          globalRecord.__kovoInlineImport = originals.importModule;
        }
      }
    },
  );
});
