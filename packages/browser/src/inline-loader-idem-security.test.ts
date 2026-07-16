import { expect, it, vi } from 'vitest';

import { inlineSourceInstallCases } from './inline-loader-test-utils.js';

it.each(inlineSourceInstallCases)(
  'uses pinned 128-bit randomness without randomUUID through %s',
  async (_name, installSource) => {
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
    const typedArrayLengthDescriptor = Object.getOwnPropertyDescriptor(
      typedArrayPrototype,
      'length',
    );
    if (!typedArrayLengthDescriptor) throw new Error('TypedArray length descriptor unavailable');
    const originals = {
      FormData: globalRecord.FormData,
      addEventListener: globalRecord.addEventListener,
      document: globalRecord.document,
      fetch: globalRecord.fetch,
      history: globalRecord.history,
      importModule: globalRecord.__kovoInlineImport,
      location: globalRecord.location,
      setTimeout: globalRecord.setTimeout,
    };
    const listeners = new Map<string, (event: unknown) => void>();
    class TestFormData {
      value = 'idem_stale_render';

      get(name: string) {
        return name === 'Kovo-Idem' ? this.value : null;
      }

      set(name: string, value: string) {
        if (name === 'Kovo-Idem') this.value = value;
      }
    }
    const nativeFormDataSet = TestFormData.prototype.set;
    const requests: Array<{ body: TestFormData; headers: Record<string, string> }> = [];
    let poisonedFormDataSetCalls = 0;
    let randomCall = 0;
    const form = {
      action: '/_m/cart/add',
      getAttribute(name: string) {
        if (name === 'data-mutation') return 'cart/add';
        return name === 'data-enhance' ? '' : null;
      },
      method: 'post',
    };

    try {
      globalRecord.FormData = TestFormData;
      globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
        listeners.set(type, listener);
      };
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: {
          getRandomValues(array: Uint8Array) {
            randomCall += 1;
            for (let index = 0; index < 16; index += 1) {
              array[index] = randomCall * 17 + index;
            }
            return array;
          },
        },
      });
      globalRecord.document = { querySelector: () => null, querySelectorAll: () => [] };
      globalRecord.fetch = vi.fn(
        async (_url: string, options: { body: TestFormData; headers: Record<string, string> }) => {
          requests.push(options);
          return {
            headers: {
              get: (name: string) =>
                name.toLowerCase() === 'content-type' ? 'text/vnd.kovo.fragment+html' : null,
            },
            status: 204,
            text: async () => '',
            url: 'https://kovo.test/_m/cart/add',
          };
        },
      );
      globalRecord.history = {};
      globalRecord.location = {
        href: 'https://kovo.test/cart',
        origin: 'https://kovo.test',
        pathname: '/cart',
        search: '',
      };
      globalRecord.setTimeout = () => 0;

      installSource(
        vi.fn(async () => ({})),
        globalRecord,
      );
      TestFormData.prototype.set = function poisonedFormDataSet() {
        poisonedFormDataSetCalls += 1;
      };
      Object.defineProperty(typedArrayPrototype, 'length', {
        configurable: true,
        get: () => 0,
      });
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: {
          getRandomValues(array: Uint8Array) {
            array.fill(0);
            return array;
          },
          randomUUID: () => '00000000-0000-4000-8000-000000000000',
        },
      });
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

      // Two boot probes consume calls 1/2; the logical submit receives call 3 (0x33..0x42).
      expect(requests[0]?.headers['Kovo-Idem']).toBe('idem_333435363738393a3b3c3d3e3f404142');
      expect(requests[0]?.body.value).toBe('idem_333435363738393a3b3c3d3e3f404142');
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

      expect(requests[1]?.headers['Kovo-Idem']).toBe('idem_4445464748494a4b4c4d4e4f50515253');
      expect(requests[1]?.body.value).toBe('idem_4445464748494a4b4c4d4e4f50515253');
      expect(requests[1]?.headers['Kovo-Idem']).not.toBe(requests[0]?.headers['Kovo-Idem']);
      expect(poisonedFormDataSetCalls).toBe(0);
    } finally {
      TestFormData.prototype.set = nativeFormDataSet;
      Object.defineProperty(typedArrayPrototype, 'length', typedArrayLengthDescriptor);
      Object.assign(globalRecord, {
        FormData: originals.FormData,
        addEventListener: originals.addEventListener,
        document: originals.document,
        fetch: originals.fetch,
        history: originals.history,
        location: originals.location,
        setTimeout: originals.setTimeout,
      });
      if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
      else delete globalRecord.crypto;
      if (originals.importModule === undefined) delete globalRecord.__kovoInlineImport;
      else globalRecord.__kovoInlineImport = originals.importModule;
    }
  },
);
