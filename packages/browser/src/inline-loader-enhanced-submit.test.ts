import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryStore, type EnhancedMutationFetchOptions } from './client.js';
import { submitEnhancedMutation } from './mutation-submit.js';
import { inlineSourceInstallCases, InlineParityRoot } from './inline-loader-test-utils.js';

class InertBroadcastChannel {
  static instances: InertBroadcastChannel[] = [];
  closed = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly posted: unknown[] = [];

  constructor(readonly name: string) {
    InertBroadcastChannel.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  postMessage(value: unknown): void {
    this.posted.push(value);
  }
}

interface InlineMutationResponse {
  headers?: { get(name: string): string | null };
  url?: string;
  [key: string]: unknown;
}

function mutationResponse(path: string, response: InlineMutationResponse): InlineMutationResponse {
  const responseHeaders = response.headers;
  const location = (globalThis as unknown as { location?: { origin?: unknown } }).location;
  const origin = typeof location?.origin === 'string' ? location.origin : 'http://localhost';
  return {
    ...response,
    headers: {
      ...responseHeaders,
      get(name: string) {
        if (name.toLowerCase() === 'content-type') {
          return 'text/vnd.kovo.fragment+html';
        }
        return responseHeaders?.get(name) ?? null;
      },
    },
    url: response.url ?? `${origin}${path}`,
  };
}

function mutationFormAttribute(
  mutation: string,
  name: string,
  extra: Readonly<Record<string, string>> = {},
): string | null {
  if (name === 'data-mutation') return mutation;
  return Object.prototype.hasOwnProperty.call(extra, name) ? (extra[name] ?? null) : null;
}

function createStructuralFormData(): {
  get(name: string): unknown;
  set(name: string, value: unknown): void;
} {
  const values = new Map<string, unknown>();
  return {
    get(name: string) {
      return values.get(name) ?? null;
    },
    set(name: string, value: unknown) {
      values.set(name, value);
    },
  };
}

function poisonMutationArrayMethods(): () => void {
  const methods = ['every', 'filter', 'flatMap'] as const;
  const descriptors = methods.map((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, name);
    if (!descriptor) throw new Error(`Missing Array.prototype.${name}`);
    return { descriptor, name };
  });
  for (const { descriptor, name } of descriptors) {
    Object.defineProperty(Array.prototype, name, {
      ...descriptor,
      value: name === 'every' ? () => false : () => [],
    });
  }
  return () => {
    for (const { descriptor, name } of descriptors) {
      Object.defineProperty(Array.prototype, name, descriptor);
    }
  };
}

describe('inline loader enhanced submit source', () => {
  const globalRecord = globalThis as unknown as Record<string, unknown>;
  let originalBroadcastChannel: unknown;

  beforeEach(() => {
    InertBroadcastChannel.instances = [];
    originalBroadcastChannel = globalRecord.BroadcastChannel;
    globalRecord.BroadcastChannel = InertBroadcastChannel;
  });

  it.each(inlineSourceInstallCases)(
    'retires the inline channel before applying a no-navigation session transition through %s',
    async (_name, installSource) => {
      const originals = {
        FormData: globalRecord.FormData,
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        fetch: globalRecord.fetch,
        importModule: globalRecord.__kovoInlineImport,
        location: globalRecord.location,
      };
      const listeners = new Map<string, (event: unknown) => void>();
      const reloadRetirementStates: boolean[] = [];
      const reload = vi.fn(() => {
        reloadRetirementStates.push(InertBroadcastChannel.instances[0]?.closed === true);
      });
      const text = vi.fn(async () => '<kovo-query name="account">{"owner":"victim"}</kovo-query>');
      const form = {
        action: '/_m/auth/custom-sign-in',
        getAttribute(name: string) {
          return mutationFormAttribute('auth/custom-sign-in', name);
        },
        method: 'post',
      };

      try {
        globalRecord.FormData = function FormData() {
          return { get: () => null };
        };
        globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
          listeners.set(type, listener);
        };
        globalRecord.document = {
          querySelector(selector: string) {
            return selector === 'meta[name="kovo-build"]'
              ? { getAttribute: () => 'build-A' }
              : null;
          },
          querySelectorAll() {
            return [];
          },
        };
        globalRecord.fetch = vi.fn(async () =>
          mutationResponse('/_m/auth/custom-sign-in', {
            headers: {
              get(name: string) {
                const normalized = name.toLowerCase();
                if (normalized === 'kovo-session-transition') return 'reload';
                if (normalized === 'kovo-reauth') return '//evil.example/phish';
                if (normalized === 'location') return 'https://evil.example/phish';
                return null;
              },
            },
            ok: false,
            status: 401,
            text,
          }),
        );
        globalRecord.location = {
          href: 'https://kovo.test/login',
          origin: 'https://kovo.test',
          pathname: '/login',
          reload,
          search: '',
        };

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

        expect(reload).toHaveBeenCalledOnce();
        expect(reloadRetirementStates).toEqual([true]);
        expect(text).not.toHaveBeenCalled();
        expect(InertBroadcastChannel.instances).toHaveLength(1);
        expect(InertBroadcastChannel.instances[0]?.closed).toBe(true);
        expect(InertBroadcastChannel.instances[0]?.posted).toEqual([]);
      } finally {
        Object.assign(globalRecord, {
          FormData: originals.FormData,
          addEventListener: originals.addEventListener,
          document: originals.document,
          fetch: originals.fetch,
          location: originals.location,
        });
        if (originals.importModule === undefined) {
          delete globalRecord.__kovoInlineImport;
        } else {
          globalRecord.__kovoInlineImport = originals.importModule;
        }
      }
    },
  );

  afterEach(() => {
    if (originalBroadcastChannel === undefined) {
      delete globalRecord.BroadcastChannel;
    } else {
      globalRecord.BroadcastChannel = originalBroadcastChannel;
    }
  });

  it.each(inlineSourceInstallCases)(
    'navigates after successful inline enhanced auth redirects through %s',
    async (_name, installSource) => {
      // SPEC §6.3/§9.1: auth mutations may succeed by PRG redirect instead of
      // returning mutation fragments; inline interception must preserve that.
      const cases = [
        {
          expected: '/',
          response: {
            headers: {
              get(name: string) {
                return name.toLowerCase() === 'location' ? '/' : null;
              },
            },
            status: 303,
          },
        },
        {
          expected: 'https://kovo.test/login',
          response: {
            headers: {
              get() {
                return null;
              },
            },
            redirected: true,
            status: 200,
            url: 'https://kovo.test/login',
          },
        },
      ] as const;
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        FormData: globalRecord.FormData,
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        fetch: globalRecord.fetch,
        importModule: globalRecord.__kovoInlineImport,
        location: globalRecord.location,
      };

      for (const { expected, response } of cases) {
        const listeners = new Map<string, (event: unknown) => void>();
        const channelIndex = InertBroadcastChannel.instances.length;
        const navigationRetirementStates: boolean[] = [];
        const assign = vi.fn(() => {
          navigationRetirementStates.push(
            InertBroadcastChannel.instances[channelIndex]?.closed === true,
          );
        });
        const preventDefault = vi.fn();
        const text = vi.fn(async () => '<kovo-fragment target="auth">stale</kovo-fragment>');
        const form = {
          action: '/_m/auth/sign-in',
          getAttribute(name: string) {
            return mutationFormAttribute('auth/sign-in', name);
          },
          method: 'post',
        };

        try {
          globalRecord.FormData = function FormData() {
            return {};
          };
          globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
            listeners.set(type, listener);
          };
          globalRecord.document = {
            querySelector(selector: string) {
              return selector === 'meta[name="kovo-build"]'
                ? { getAttribute: () => 'build-A' }
                : null;
            },
            querySelectorAll() {
              return [];
            },
          };
          globalRecord.fetch = vi.fn(async () =>
            mutationResponse('/_m/auth/sign-in', {
              ...response,
              text,
            }),
          );
          globalRecord.location = {
            assign,
            href: 'https://kovo.test/login?next=%2F',
            origin: 'https://kovo.test',
          };

          installSource(
            vi.fn(async () => ({})),
            globalRecord,
          );
          const runtimeChannel = InertBroadcastChannel.instances[channelIndex];
          if (!runtimeChannel) throw new Error('inline mutation broadcast unavailable');
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
          expect(assign).toHaveBeenCalledWith(expected);
          expect(text).not.toHaveBeenCalled();
          expect(navigationRetirementStates).toEqual([false]);
          expect(runtimeChannel.closed).toBe(false);
          expect(runtimeChannel.onmessage).not.toBeNull();
        } finally {
          Object.assign(globalRecord, {
            FormData: originals.FormData,
            addEventListener: originals.addEventListener,
            document: originals.document,
            fetch: originals.fetch,
            location: originals.location,
          });
          if (originals.importModule === undefined) {
            delete globalRecord.__kovoInlineImport;
          } else {
            globalRecord.__kovoInlineImport = originals.importModule;
          }
        }
      }
    },
  );

  it.each(inlineSourceInstallCases)(
    'navigates after successful inline enhanced auth empty-fragment responses through %s',
    async (_name, installSource) => {
      // SPEC §6.3/§9.1/§9.3: when auth commits through the enhanced mutation
      // path but produces no refreshable fragments, the browser must retire the old
      // principal and document-navigate even after app code mutates array prototypes.
      const cases = [
        { expected: '/dashboard?tab=home', next: '/dashboard?tab=home' },
        { expected: '/', next: 'https://evil.example/account' },
      ] as const;
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        FormData: globalRecord.FormData,
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        fetch: globalRecord.fetch,
        importModule: globalRecord.__kovoInlineImport,
        location: globalRecord.location,
      };

      for (const { expected, next } of cases) {
        const listeners = new Map<string, (event: unknown) => void>();
        const channelIndex = InertBroadcastChannel.instances.length;
        const navigationRetirementStates: boolean[] = [];
        const assign = vi.fn(() => {
          navigationRetirementStates.push(
            InertBroadcastChannel.instances[channelIndex]?.closed === true,
          );
        });
        const preventDefault = vi.fn();
        const text = vi.fn(async () => '');
        const form = {
          action: '/_m/auth/sign-in',
          getAttribute(name: string) {
            return mutationFormAttribute('auth/sign-in', name);
          },
          method: 'post',
        };

        try {
          globalRecord.FormData = function FormData() {
            return {
              get(name: string) {
                return name === 'next' ? next : null;
              },
            };
          };
          globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
            listeners.set(type, listener);
          };
          globalRecord.document = {
            querySelector(selector: string) {
              return selector === 'meta[name="kovo-build"]'
                ? { getAttribute: () => 'build-A' }
                : null;
            },
            querySelectorAll() {
              return [];
            },
          };
          globalRecord.fetch = vi.fn(async () =>
            mutationResponse('/_m/auth/sign-in', {
              headers: {
                get(name: string) {
                  return name.toLowerCase() === 'kovo-changes' ? '[{"domain":"auth"}]' : null;
                },
              },
              ok: true,
              status: 200,
              text,
            }),
          );
          globalRecord.location = {
            assign,
            hash: '',
            href: 'https://kovo.test/login?next=%2Fdashboard',
            origin: 'https://kovo.test',
            pathname: '/login',
            search: '?next=%2Fdashboard',
          };

          installSource(
            vi.fn(async () => ({})),
            globalRecord,
          );
          const runtimeChannel = InertBroadcastChannel.instances[channelIndex];
          if (!runtimeChannel) throw new Error('inline mutation broadcast unavailable');
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
          const restoreArrays = poisonMutationArrayMethods();
          try {
            await Promise.resolve();
            await Promise.resolve();
            await new Promise((resolve) => setTimeout(resolve, 0));
          } finally {
            restoreArrays();
          }

          expect(preventDefault).toHaveBeenCalledTimes(1);
          expect(assign).toHaveBeenCalledWith(expected);
          expect(text).toHaveBeenCalledTimes(1);
          expect(navigationRetirementStates).toEqual([true]);
          expect(runtimeChannel.closed).toBe(true);
          expect(runtimeChannel.onmessage).toBeNull();
        } finally {
          Object.assign(globalRecord, {
            FormData: originals.FormData,
            addEventListener: originals.addEventListener,
            document: originals.document,
            fetch: originals.fetch,
            location: originals.location,
          });
          if (originals.importModule === undefined) {
            delete globalRecord.__kovoInlineImport;
          } else {
            globalRecord.__kovoInlineImport = originals.importModule;
          }
        }
      }
    },
  );

  it.each(inlineSourceInstallCases)(
    'sanitizes inline 401 Kovo-Reauth before navigation through %s',
    async (_name, installSource) => {
      // SPEC §6.5: the inline enhanced-submit path treats Kovo-Reauth as an
      // untrusted browser navigation sink even when framework servers sanitize it.
      const cases = [
        ['/login?next=%2Fcart', '/login?next=%2Fcart'],
        ['https://evil.example/login', '/'],
        ['//evil.example/login', '/'],
        ['/\\evil.example/login', '/'],
        ['/%0a/login', '/'],
      ] as const;
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        FormData: globalRecord.FormData,
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        fetch: globalRecord.fetch,
        importModule: globalRecord.__kovoInlineImport,
        location: globalRecord.location,
      };

      for (const [reauth, expected] of cases) {
        const listeners = new Map<string, (event: unknown) => void>();
        const channelIndex = InertBroadcastChannel.instances.length;
        const navigationRetirementStates: boolean[] = [];
        const assign = vi.fn(() => {
          navigationRetirementStates.push(
            InertBroadcastChannel.instances[channelIndex]?.closed === true,
          );
        });
        const preventDefault = vi.fn();
        const form = {
          action: '/_m/cart/add',
          getAttribute(name: string) {
            return mutationFormAttribute('cart/add', name);
          },
          method: 'post',
        };

        try {
          globalRecord.FormData = function FormData() {
            return {};
          };
          globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
            listeners.set(type, listener);
          };
          globalRecord.document = {
            querySelector(selector: string) {
              return selector === 'meta[name="kovo-build"]'
                ? { getAttribute: () => 'build-A' }
                : null;
            },
            querySelectorAll() {
              return [];
            },
          };
          globalRecord.fetch = vi.fn(async () =>
            mutationResponse('/_m/cart/add', {
              headers: {
                get(name: string) {
                  return name.toLowerCase() === 'kovo-reauth' ? reauth : null;
                },
              },
              status: 401,
              text: vi.fn(async () => '<kovo-fragment target="cart">wrong</kovo-fragment>'),
            }),
          );
          globalRecord.location = {
            assign,
            href: 'https://kovo.test/cart',
            origin: 'https://kovo.test',
          };

          installSource(
            vi.fn(async () => ({})),
            globalRecord,
          );
          const runtimeChannel = InertBroadcastChannel.instances[channelIndex];
          if (!runtimeChannel) throw new Error('inline mutation broadcast unavailable');
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
          expect(assign).toHaveBeenCalledWith(expected);
          expect(navigationRetirementStates).toEqual([true]);
          expect(runtimeChannel.closed).toBe(true);
          expect(runtimeChannel.onmessage).toBeNull();
        } finally {
          Object.assign(globalRecord, {
            FormData: originals.FormData,
            addEventListener: originals.addEventListener,
            document: originals.document,
            fetch: originals.fetch,
            location: originals.location,
          });
          if (originals.importModule === undefined) {
            delete globalRecord.__kovoInlineImport;
          } else {
            globalRecord.__kovoInlineImport = originals.importModule;
          }
        }
      }
    },
  );

  it.each(inlineSourceInstallCases)(
    'keeps inline mutation authority for non-401 stray reauth headers through %s',
    async (_name, installSource) => {
      const originals = {
        FormData: globalRecord.FormData,
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        fetch: globalRecord.fetch,
        importModule: globalRecord.__kovoInlineImport,
        location: globalRecord.location,
      };
      const listeners = new Map<string, (event: unknown) => void>();
      const channelIndex = InertBroadcastChannel.instances.length;
      const assign = vi.fn();
      const text = vi.fn(async () => '');
      const form = {
        action: '/_m/account/update',
        getAttribute(name: string) {
          return mutationFormAttribute('account/update', name);
        },
        method: 'post',
      };

      try {
        globalRecord.FormData = function FormData() {
          return { get: () => null };
        };
        globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
          listeners.set(type, listener);
        };
        globalRecord.document = {
          querySelector(selector: string) {
            return selector === 'meta[name="kovo-build"]'
              ? { getAttribute: () => 'build-A' }
              : null;
          },
          querySelectorAll() {
            return [];
          },
        };
        globalRecord.fetch = vi.fn(async () =>
          mutationResponse('/_m/account/update', {
            headers: {
              get(name: string) {
                const normalized = name.toLowerCase();
                if (normalized === 'kovo-reauth') return '/login';
                if (normalized === 'kovo-build') return 'build-A';
                return null;
              },
            },
            ok: true,
            status: 200,
            text,
          }),
        );
        globalRecord.location = {
          assign,
          href: 'https://kovo.test/account',
          origin: 'https://kovo.test',
        };

        installSource(
          vi.fn(async () => ({})),
          globalRecord,
        );
        const runtimeChannel = InertBroadcastChannel.instances[channelIndex];
        if (!runtimeChannel) throw new Error('inline mutation broadcast unavailable');
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

        expect(assign).not.toHaveBeenCalled();
        expect(text).toHaveBeenCalledOnce();
        expect(runtimeChannel.closed).toBe(false);
        expect(runtimeChannel.onmessage).not.toBeNull();
      } finally {
        Object.assign(globalRecord, {
          FormData: originals.FormData,
          addEventListener: originals.addEventListener,
          document: originals.document,
          fetch: originals.fetch,
          location: originals.location,
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
    'keeps inline reauth and auth-success redirects same-origin after late control poisoning through %s',
    async (_name, installSource) => {
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originalStartsWith = String.prototype.startsWith;
      const originalDecodeURIComponent = globalThis.decodeURIComponent;
      const originals = {
        FormData: globalRecord.FormData,
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        fetch: globalRecord.fetch,
        importModule: globalRecord.__kovoInlineImport,
        location: globalRecord.location,
      };

      for (const variant of ['reauth', 'auth-success'] as const) {
        const listeners = new Map<string, (event: unknown) => void>();
        const assign = vi.fn();
        const form = {
          action: variant === 'reauth' ? '/_m/cart/add' : '/_m/auth/sign-in',
          getAttribute(name: string) {
            return mutationFormAttribute(variant === 'reauth' ? 'cart/add' : 'auth/sign-in', name);
          },
          method: 'post',
        };
        try {
          globalRecord.FormData = function FormData() {
            return {
              get(name: string) {
                return name === 'next' && variant === 'auth-success'
                  ? '/\\evil.example/phish'
                  : null;
              },
            };
          };
          globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
            listeners.set(type, listener);
          };
          globalRecord.document = { querySelectorAll: () => [] };
          globalRecord.fetch = vi.fn(async () =>
            mutationResponse(variant === 'reauth' ? '/_m/cart/add' : '/_m/auth/sign-in', {
              headers: {
                get(name: string) {
                  if (variant === 'reauth' && name === 'Kovo-Reauth') {
                    return '//evil.example/phish';
                  }
                  if (variant === 'auth-success' && name === 'Kovo-Changes') {
                    return '[{"domain":"auth"}]';
                  }
                  return null;
                },
              },
              ok: true,
              status: variant === 'reauth' ? 401 : 200,
              text: async () => '',
            }),
          );
          globalRecord.location = {
            assign,
            hash: '',
            href: 'https://kovo.test/cart',
            origin: 'https://kovo.test',
            pathname: '/cart',
            search: '',
          };

          installSource(
            vi.fn(async () => ({})),
            globalRecord,
          );
          String.prototype.startsWith = function (search: string, position?: number) {
            if (this.valueOf() === '//evil.example/phish') return search === '/';
            return Reflect.apply(originalStartsWith, this, [search, position]);
          };
          Object.defineProperty(globalThis, 'decodeURIComponent', {
            configurable: true,
            value: () => '/',
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
          await new Promise((resolve) => setTimeout(resolve, 0));

          expect(assign).toHaveBeenCalledWith('/');
        } finally {
          String.prototype.startsWith = originalStartsWith;
          Object.defineProperty(globalThis, 'decodeURIComponent', {
            configurable: true,
            value: originalDecodeURIComponent,
          });
          Object.assign(globalRecord, {
            FormData: originals.FormData,
            addEventListener: originals.addEventListener,
            document: originals.document,
            fetch: originals.fetch,
            location: originals.location,
          });
          if (originals.importModule === undefined) {
            delete globalRecord.__kovoInlineImport;
          } else {
            globalRecord.__kovoInlineImport = originals.importModule;
          }
        }
      }
    },
  );

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
          return mutationFormAttribute('cart/add', name);
        },
        method: 'post',
        removeAttribute(name: string) {
          attributes.delete(name);
        },
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
    'requires compiler-owned same-origin POST mutation transport through %s',
    async (_name, installSource) => {
      const originals = {
        FormData: globalRecord.FormData,
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        fetch: globalRecord.fetch,
        importModule: globalRecord.__kovoInlineImport,
        location: globalRecord.location,
      };
      const listeners = new Map<string, (event: unknown) => void>();
      const fetch = vi.fn(async () => mutationResponse('/_m/cart/add', { text: async () => '' }));
      const typedForm = {
        action: '/_m/cart/add',
        getAttribute(name: string) {
          return mutationFormAttribute('cart/add', name, { enhance: '' });
        },
        method: 'post',
      };
      const candidates = [
        {
          form: {
            action: '/_m/cart/add',
            getAttribute: (name: string) => (name === 'enhance' ? '' : null),
            method: 'post',
          },
          submitter: undefined,
        },
        {
          form: typedForm,
          submitter: {
            getAttribute: (name: string) => (name === 'formaction' ? '/checkout' : null),
          },
        },
        {
          form: typedForm,
          submitter: {
            getAttribute: (name: string) => (name === 'formmethod' ? 'get' : null),
          },
        },
        {
          form: typedForm,
          submitter: {
            getAttribute: (name: string) =>
              name === 'formaction' ? 'https://attacker.test/_m/cart/add' : null,
          },
        },
      ];

      try {
        globalRecord.FormData = function FormData() {
          return createStructuralFormData();
        };
        globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
          listeners.set(type, listener);
        };
        globalRecord.document = { querySelectorAll: () => [] };
        globalRecord.fetch = fetch;
        globalRecord.location = {
          hash: '#private',
          href: 'https://kovo.test/account?tab=security#private',
          origin: 'https://kovo.test',
          pathname: '/account',
          search: '?tab=security',
        };

        installSource(
          vi.fn(async () => ({})),
          globalRecord,
        );

        for (const candidate of candidates) {
          const preventDefault = vi.fn();
          listeners.get('submit')?.({
            preventDefault,
            submitter: candidate.submitter,
            target: {
              closest: () => candidate.form,
            },
            type: 'submit',
          });
          expect(preventDefault).not.toHaveBeenCalled();
        }

        const preventDefault = vi.fn();
        listeners.get('submit')?.({
          preventDefault,
          submitter: { getAttribute: () => null },
          target: { closest: () => typedForm },
          type: 'submit',
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith(
          '/_m/cart/add',
          expect.objectContaining({
            headers: expect.objectContaining({
              'Kovo-Current-Url': 'https://kovo.test/account?tab=security',
            }),
            method: 'POST',
          }),
        );
      } finally {
        Object.assign(globalRecord, {
          FormData: originals.FormData,
          addEventListener: originals.addEventListener,
          document: originals.document,
          fetch: originals.fetch,
          location: originals.location,
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
    'rejects unproven inline mutation responses before apply through %s',
    async (_name, installSource) => {
      const originals = {
        FormData: globalRecord.FormData,
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        fetch: globalRecord.fetch,
        importModule: globalRecord.__kovoInlineImport,
        location: globalRecord.location,
      };

      try {
        for (const response of [
          {
            headers: { get: () => 'text/vnd.kovo.fragment+html' },
            url: 'https://attacker.test/_m/cart/add',
          },
          {
            headers: { get: () => 'text/html' },
            url: 'https://kovo.test/_m/cart/add',
          },
        ]) {
          const listeners = new Map<string, (event: unknown) => void>();
          const text = vi.fn(async () => '<kovo-fragment target="cart">unsafe</kovo-fragment>');
          const requestSubmit = vi.fn();
          const attributes = new Map<string, string>();
          const form = {
            action: '/_m/cart/add',
            getAttribute(name: string) {
              return mutationFormAttribute('cart/add', name, { enhance: '' });
            },
            method: 'post',
            removeAttribute(name: string) {
              attributes.delete(name);
            },
            requestSubmit,
            setAttribute(name: string, value: string) {
              attributes.set(name, value);
            },
          };
          const submitter = { getAttribute: () => null };
          globalRecord.FormData = function FormData() {
            return createStructuralFormData();
          };
          globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
            listeners.set(type, listener);
          };
          globalRecord.document = { querySelectorAll: () => [] };
          globalRecord.fetch = vi.fn(async () => ({ ...response, text }));
          globalRecord.location = {
            hash: '',
            href: 'https://kovo.test/cart',
            origin: 'https://kovo.test',
            pathname: '/cart',
            search: '',
          };

          installSource(
            vi.fn(async () => ({})),
            globalRecord,
          );
          listeners.get('submit')?.({
            preventDefault: vi.fn(),
            submitter,
            target: { closest: () => form },
            type: 'submit',
          });
          await new Promise((resolve) => setTimeout(resolve, 0));

          expect(text).not.toHaveBeenCalled();
          expect(requestSubmit).toHaveBeenCalledWith(submitter);
          expect(attributes.has('data-kovo-native-fallback')).toBe(false);
        }
      } finally {
        Object.assign(globalRecord, {
          FormData: originals.FormData,
          addEventListener: originals.addEventListener,
          document: originals.document,
          fetch: originals.fetch,
          location: originals.location,
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
          return mutationFormAttribute('cart/add', name, { enhance: '' });
        },
        id: { toString: () => '[object HTMLInputElement]' },
        method: 'post',
      };
      const targetDeps = [
        { deps: 'cart', id: 'cart-badge', token: 'tok_cart' },
        { deps: 'cart', id: 'cart-badge', token: 'tok_cart' },
        {
          component: 'components/inventory/inventory',
          deps: 'inventory, stock',
          id: 'inventory-panel',
          props: '{"warehouseId":"w1"}',
          target: 'inventory',
          token: 'tok_inventory',
        },
        { deps: 'debug', id: 'empty-fragment-target-fallback', target: '' },
        { deps: '', id: 'standalone-target', token: 'tok_standalone' },
        {
          component: 'cart-summary',
          deps: 'cart summary',
          id: 'cart-summary',
          token: 'tok_summary',
          token: 'tok_summary',
        },
      ];
      const modularRoot = new InlineParityRoot();
      const parityIdem = '00000000-0000-4000-8000-000000000003';
      const modularFetch = vi.fn(async (_url: string, _options: EnhancedMutationFetchOptions) =>
        mutationResponse('/_m/cart/add', {
          headers: {
            get() {
              return null;
            },
          },
          async text() {
            return '';
          },
          url: 'http://localhost/_m/cart/add',
        }),
      );
      modularRoot.deps = targetDeps;

      await submitEnhancedMutation({
        fetch: modularFetch,
        form,
        formData,
        idem: parityIdem,
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
      const inlineFetch = vi.fn(async (_url: string, _options: EnhancedMutationFetchOptions) =>
        mutationResponse('/_m/cart/add', {
          async text() {
            return '';
          },
        }),
      );

      try {
        let randomUuidCall = 0;
        Object.defineProperty(globalThis, 'crypto', {
          configurable: true,
          value: {
            randomUUID: () => {
              randomUuidCall += 1;
              return `00000000-0000-4000-8000-${String(randomUuidCall).padStart(12, '0')}`;
            },
          },
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
                if (name === 'kovo-live-token') return dep.token ?? null;
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
        const modularRequest = modularFetch.mock.calls[0];
        expect(inlineRequest).toEqual([
          modularRequest?.[0],
          {
            ...modularRequest?.[1],
            headers: {
              ...modularRequest?.[1].headers,
              'Kovo-Current-Url': 'https://kovo.test/',
            },
          },
        ]);
        expect(inlineRequest?.[1].headers['Kovo-Targets']).toBe(
          'cart-badge=cart; inventory=inventory stock; standalone-target; cart-summary=cart summary',
        );
        expect(inlineRequest?.[1].headers['Kovo-Live-Targets']).toBe(
          'cart-badge#cart-badge@tok_cart:{}; inventory#components/inventory/inventory@tok_inventory:{"warehouseId":"w1"}; standalone-target#standalone-target@tok_standalone:{}; cart-summary#cart-summary@tok_summary:{}',
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
          return mutationFormAttribute('cart/add', name, { enhance: '' });
        },
        method: 'post',
      };
      const submitter = { name: 'intent', value: 'preview' };
      const inlineFetch = vi.fn(async () =>
        mutationResponse('/_m/cart/add', {
          async text() {
            return '';
          },
        }),
      );

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
    'streams inline enhanced mutation text through a boot-pinned decoder in %s',
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
      const nativeTextDecoderDecode = TextDecoder.prototype.decode;
      const nativeStringSlice = String.prototype.slice;
      const formData = { kind: 'stream-form-data' };
      const rendererReference = '/c/client.ts#renderMarkdownStream';
      const streamTargetAttrs = new Map<string, string>([
        ['data-stream-renderer', rendererReference],
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
          if (name === 'data-mutation') return 'chat/send';
          if (name === 'data-mutation-stream') return 'true';
          if (name === 'kovo-fragment-target') return 'composer';
          return null;
        },
        method: 'post',
      };
      const renderMarkdownStream = vi.fn((target: typeof streamTarget, source: string) => {
        target.setAttribute('data-rendered-markdown', source.includes('|') ? 'table' : 'plain');
      });
      const privileged = vi.fn((target: typeof streamTarget) => {
        target.setAttribute('data-rendered-markdown', 'privileged');
      });
      const importModule = vi.fn(async () => {
        // Module evaluation happens before export selection. It must not be able to redirect the
        // already-declared renderer by poisoning the shared String prototype during import.
        String.prototype.slice = function poisonedRendererSlice(start, end) {
          const source = Reflect.apply(nativeStringSlice, this, [0]);
          if (source === rendererReference && start > 0) return 'privileged';
          return Reflect.apply(nativeStringSlice, this, [start, end]);
        };
        return {
          privileged,
          renderMarkdownStream,
        };
      });
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
      const inlineFetch = vi.fn(async () => mutationResponse('/_m/chat/send', { body }));

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
          querySelectorAll(selector: string) {
            return selector === '[data-kovo-module-allowlist]'
              ? [{ getAttribute: () => '/c/client.ts' }]
              : [];
          },
        };
        globalRecord.fetch = inlineFetch;

        installSource(importModule, globalRecord);
        // C107 / SPEC §6.6 rule 5: authored code runs after loader bootstrap and
        // cannot substitute different wire truth through a one-shot decoder poison.
        TextDecoder.prototype.decode = function poisonedDecode(
          this: TextDecoder,
          input?: AllowSharedBufferSource,
        ): string {
          if (input !== undefined) {
            TextDecoder.prototype.decode = nativeTextDecoderDecode;
            return '<kovo-text target="assistant:a1">ATTACKER-SUBSTITUTED</kovo-text><kovo-done></kovo-done>';
          }
          return Reflect.apply(nativeTextDecoderDecode, this, []);
        } as typeof TextDecoder.prototype.decode;
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
        expect(importModule).toHaveBeenCalledWith('/c/client.ts');
        expect(renderMarkdownStream).toHaveBeenCalled();
        expect(privileged).not.toHaveBeenCalled();
      } finally {
        TextDecoder.prototype.decode = nativeTextDecoderDecode;
        String.prototype.slice = nativeStringSlice;
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

  it.each(inlineSourceInstallCases)(
    'applies coalesced streaming fragments before their text chunks through %s',
    async (_name, installSource) => {
      // SPEC.md §9.1: streaming assistant shells are ordinary append fragments,
      // and <kovo-text> targets a runtime-declared data-stream-text source. A
      // browser stream read may coalesce both wire elements into one chunk, so
      // the inline loader must apply the fragment before the following text.
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        CustomEvent: globalRecord.CustomEvent,
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
      const formData = { kind: 'coalesced-stream-form-data' };
      const streamTargetAttrs = new Map<string, string>([
        ['data-stream-renderer', '/c/client.ts#renderMarkdownStream'],
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
      let streamTargetInserted = false;
      const messagesTarget = {
        append(...nodes: Array<{ outerHTML?: string }>) {
          if (nodes.some((node) => node.outerHTML?.includes('data-stream-text="assistant:a1"'))) {
            streamTargetInserted = true;
          }
        },
        insertAdjacentHTML(_position: string, html: string) {
          if (html.includes('data-stream-text="assistant:a1"')) streamTargetInserted = true;
        },
        querySelectorAll() {
          return [];
        },
      };
      const form = {
        action: '/_m/chat/send',
        getAttribute(name: string) {
          if (name === 'data-mutation') return 'chat/send';
          if (name === 'data-mutation-stream') return 'true';
          if (name === 'kovo-fragment-target') return 'composer';
          return null;
        },
        method: 'post',
      };
      const importModule = vi.fn(async () => ({
        renderMarkdownStream(target: typeof streamTarget, source: string) {
          target.setAttribute(
            'data-rendered-markdown',
            source.includes('|') && source.includes('```') ? 'table code' : 'plain',
          );
        },
      }));
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                '<kovo-fragment target="messages" mode="append"><article><p data-stream-text="assistant:a1" data-stream-renderer="/c/client.ts#renderMarkdownStream"></p></article></kovo-fragment>',
                '<kovo-text target="assistant:a1">| table</kovo-text>',
                '<kovo-text target="assistant:a1" mode="checkpoint">| table\n```ts\nok\n```</kovo-text>',
                '<kovo-done reason="error"></kovo-done>',
                '\n',
              ].join(''),
            ),
          );
          controller.close();
        },
      });
      const inlineFetch = vi.fn(async () => mutationResponse('/_m/chat/send', { body }));

      try {
        globalRecord.CustomEvent = class CustomEvent {
          type: string;

          constructor(type: string) {
            this.type = type;
          }
        };
        globalRecord.FormData = function FormData() {
          return formData;
        };
        globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
          listeners.set(type, listener);
        };
        globalRecord.dispatchEvent = vi.fn();
        globalRecord.document = {
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
            if (selector === '[kovo-fragment-target="messages"]') return messagesTarget;
            if (selector === '[data-stream-text="assistant:a1"]' && streamTargetInserted) {
              return streamTarget;
            }
            return null;
          },
          querySelectorAll(selector: string) {
            return selector === '[data-kovo-module-allowlist]'
              ? [{ getAttribute: () => '/c/client.ts' }]
              : [];
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

        expect(streamTargetInserted).toBe(true);
        expect(streamTarget.textContent).toBe('| table\n```ts\nok\n```');
        expect(streamTargetAttrs.get('data-stream-state')).toBe('error');
        expect(streamTargetAttrs.get('data-rendered-markdown')).toBe('table code');
        expect(importModule).toHaveBeenCalledWith('/c/client.ts');
      } finally {
        Object.assign(globalRecord, {
          CustomEvent: originals.CustomEvent,
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

  it.each(inlineSourceInstallCases)(
    'marks streaming submissions failed when text targets are missing through %s',
    async (_name, installSource) => {
      // SPEC.md §9.1: missing stream text targets must fail or recover; they
      // cannot silently turn a streamed mutation into a successful no-op.
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        FormData: globalRecord.FormData,
        TextDecoder: globalRecord.TextDecoder,
        TextEncoder: globalRecord.TextEncoder,
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        fetch: globalRecord.fetch,
        importModule: globalRecord.__kovoInlineImport,
        location: globalRecord.location,
      };
      const listeners = new Map<string, (event: unknown) => void>();
      const formData = { kind: 'missing-target-stream-form-data' };
      const formAttrs = new Map<string, string>();
      const reload = vi.fn();
      const form = {
        action: '/_m/chat/send',
        getAttribute(name: string) {
          if (name === 'data-mutation') return 'chat/send';
          if (name === 'data-mutation-stream') return 'true';
          if (name === 'kovo-fragment-target') return 'composer';
          return formAttrs.get(name) ?? null;
        },
        method: 'post',
        setAttribute(name: string, value: string) {
          formAttrs.set(name, value);
        },
      };
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              '<kovo-text target="assistant:missing">lost</kovo-text><kovo-done></kovo-done>',
            ),
          );
          controller.close();
        },
      });

      try {
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
          querySelectorAll() {
            return [];
          },
        };
        globalRecord.fetch = vi.fn(async () => mutationResponse('/_m/chat/send', { body }));
        globalRecord.location = {
          hash: '',
          href: 'https://kovo.test/chat',
          origin: 'https://kovo.test',
          pathname: '/chat',
          reload,
          search: '',
        };

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

        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(reload).toHaveBeenCalledTimes(1);
        expect(formAttrs.get('data-error-code')).toBeUndefined();
        expect(formAttrs.get('kovo-error')).toBeUndefined();
      } finally {
        Object.assign(globalRecord, {
          FormData: originals.FormData,
          TextDecoder: originals.TextDecoder,
          TextEncoder: originals.TextEncoder,
          addEventListener: originals.addEventListener,
          document: originals.document,
          fetch: originals.fetch,
          location: originals.location,
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
    'refetches inline delta chunks instead of dispatching them through %s',
    async (_name, installSource) => {
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        CustomEvent: globalRecord.CustomEvent,
        FormData: globalRecord.FormData,
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        dispatchEvent: globalRecord.dispatchEvent,
        fetch: globalRecord.fetch,
        importModule: globalRecord.__kovoInlineImport,
      };
      const listeners = new Map<string, (event: unknown) => void>();
      const dispatched: unknown[] = [];

      try {
        globalRecord.CustomEvent = class CustomEvent {
          detail: unknown;
          type: string;

          constructor(type: string, init: { detail?: unknown } = {}) {
            this.type = type;
            this.detail = init.detail;
          }
        };
        globalRecord.FormData = function FormData() {
          return {};
        };
        globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
          listeners.set(type, listener);
        };
        globalRecord.dispatchEvent = (event: unknown) => {
          dispatched.push(event);
          return true;
        };
        globalRecord.document = {
          getElementById() {
            return null;
          },
          querySelector(selector: string) {
            return selector === 'meta[name="kovo-build"]'
              ? { getAttribute: (name: string) => (name === 'content' ? 'build-A' : null) }
              : null;
          },
          querySelectorAll() {
            return [];
          },
        };
        const fetch = vi.fn(async (url: string) =>
          url === '/_q/cart'
            ? {
                headers: {
                  get(name: string) {
                    if (name === 'Kovo-Build') return 'build-A';
                    if (name === 'content-type') return 'text/vnd.kovo.fragment+html';
                    return null;
                  },
                },
                status: 200,
                async text() {
                  return '<kovo-query name="cart">{"count":3}</kovo-query>';
                },
              }
            : mutationResponse('/_m/cart/add', {
                headers: {
                  get(name: string) {
                    if (name === 'Kovo-Build') return 'build-A';
                    if (name === 'content-type') return 'text/vnd.kovo.fragment+html';
                    return null;
                  },
                },
                status: 200,
                async text() {
                  return '<kovo-query name="cart" delta>{"set":{"count":3}}</kovo-query>';
                },
              }),
        );
        globalRecord.fetch = fetch;

        installSource(
          vi.fn(async () => ({})),
          globalRecord,
        );
        listeners.get('submit')?.({
          preventDefault: vi.fn(),
          target: {
            closest(selector: string) {
              return selector === 'form[enhance],form[data-enhance],form[data-mutation]'
                ? {
                    action: '/_m/cart/add',
                    getAttribute(name: string) {
                      return mutationFormAttribute('cart/add', name, { enhance: '' });
                    },
                    method: 'post',
                  }
                : null;
            },
          },
          type: 'submit',
        });

        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        // SPEC.md §9.1.1/§14: inline loader has no direct query-store base,
        // so delta chunks recover through full /_q reads instead of being
        // dispatched as confirmed server truth.
        expect(fetch).toHaveBeenNthCalledWith(2, '/_q/cart', {
          cache: 'no-store',
          headers: { Accept: 'text/html', 'Kovo-Fragment': 'true' },
          method: 'GET',
        });
        expect(dispatched).toHaveLength(2);
        const firstQueries = (dispatched[0] as { detail?: { queries?: unknown[]; qs?: unknown[] } })
          .detail;
        const secondQueries = (
          dispatched[1] as {
            detail?: { queries?: Array<{ attrs: string }>; qs?: Array<{ attrs: string }> };
          }
        ).detail;
        expect(firstQueries?.queries ?? firstQueries?.qs).toEqual([]);
        expect((secondQueries?.queries ?? secondQueries?.qs)?.[0]?.attrs).toContain('name="cart"');
      } finally {
        Object.assign(globalRecord, {
          CustomEvent: originals.CustomEvent,
          FormData: originals.FormData,
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

  it.each(inlineSourceInstallCases)(
    'dispatches full inline query chunks whose key contains delta through %s',
    async (_name, installSource) => {
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        CustomEvent: globalRecord.CustomEvent,
        FormData: globalRecord.FormData,
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        dispatchEvent: globalRecord.dispatchEvent,
        fetch: globalRecord.fetch,
        importModule: globalRecord.__kovoInlineImport,
      };
      const listeners = new Map<string, (event: unknown) => void>();
      const dispatched: unknown[] = [];

      try {
        globalRecord.CustomEvent = class CustomEvent {
          detail: unknown;
          type: string;

          constructor(type: string, init: { detail?: unknown } = {}) {
            this.type = type;
            this.detail = init.detail;
          }
        };
        globalRecord.FormData = function FormData() {
          return {};
        };
        globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
          listeners.set(type, listener);
        };
        globalRecord.dispatchEvent = (event: unknown) => {
          dispatched.push(event);
          return true;
        };
        globalRecord.document = {
          getElementById() {
            return null;
          },
          querySelector(selector: string) {
            return selector === 'meta[name="kovo-build"]'
              ? { getAttribute: (name: string) => (name === 'content' ? 'build-A' : null) }
              : null;
          },
          querySelectorAll() {
            return [];
          },
        };
        const fetch = vi.fn(async () =>
          mutationResponse('/_m/cart/add', {
            headers: { get: (name: string) => (name === 'Kovo-Build' ? 'build-A' : null) },
            status: 200,
            async text() {
              return '<kovo-query name="cart" key="cart delta fresh">{"count":3}</kovo-query>';
            },
          }),
        );
        globalRecord.fetch = fetch;

        installSource(
          vi.fn(async () => ({})),
          globalRecord,
        );
        listeners.get('submit')?.({
          preventDefault: vi.fn(),
          target: {
            closest(selector: string) {
              return selector === 'form[enhance],form[data-enhance],form[data-mutation]'
                ? {
                    action: '/_m/cart/add',
                    getAttribute(name: string) {
                      return mutationFormAttribute('cart/add', name, { enhance: '' });
                    },
                    method: 'post',
                  }
                : null;
            },
          },
          type: 'submit',
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(dispatched).toHaveLength(1);
        const detail = (
          dispatched[0] as {
            detail?: { queries?: Array<{ attrs: string }>; qs?: Array<{ attrs: string }> };
          }
        ).detail;
        expect((detail?.queries ?? detail?.qs)?.[0]?.attrs).toContain('key="cart delta fresh"');
      } finally {
        Object.assign(globalRecord, {
          CustomEvent: originals.CustomEvent,
          FormData: originals.FormData,
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

  it.each(inlineSourceInstallCases)(
    'hard-recovers fragment-only inline mutation build skew through %s',
    async (_name, installSource) => {
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        CustomEvent: globalRecord.CustomEvent,
        FormData: globalRecord.FormData,
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        dispatchEvent: globalRecord.dispatchEvent,
        fetch: globalRecord.fetch,
        importModule: globalRecord.__kovoInlineImport,
        location: globalRecord.location,
      };
      const listeners = new Map<string, (event: unknown) => void>();
      const target = {
        insertAdjacentHTML: vi.fn(),
        replaceChildren: vi.fn(),
      };
      const reload = vi.fn();

      try {
        globalRecord.CustomEvent = class CustomEvent {
          type: string;

          constructor(type: string) {
            this.type = type;
          }
        };
        globalRecord.FormData = function FormData() {
          return {};
        };
        globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
          listeners.set(type, listener);
        };
        globalRecord.dispatchEvent = vi.fn();
        globalRecord.location = {
          href: 'https://kovo.test/cart',
          origin: 'https://kovo.test',
          pathname: '/cart',
          reload,
          search: '',
        };
        globalRecord.document = {
          getElementById(id: string) {
            return id === 'cart-panel' ? target : null;
          },
          querySelector(selector: string) {
            return selector === 'meta[name="kovo-build"]'
              ? { getAttribute: (name: string) => (name === 'content' ? 'build-A' : null) }
              : null;
          },
          querySelectorAll() {
            return [];
          },
        };
        globalRecord.fetch = vi.fn(async () =>
          mutationResponse('/_m/cart/add', {
            headers: { get: (name: string) => (name === 'Kovo-Build' ? 'build-B' : null) },
            status: 200,
            async text() {
              return '<kovo-fragment target="cart-panel" mode="append"><section>wrong-build</section></kovo-fragment>';
            },
          }),
        );

        installSource(
          vi.fn(async () => ({})),
          globalRecord,
        );
        listeners.get('submit')?.({
          preventDefault: vi.fn(),
          target: {
            closest(selector: string) {
              return selector === 'form[enhance],form[data-enhance],form[data-mutation]'
                ? {
                    action: '/_m/cart/add',
                    getAttribute(name: string) {
                      return mutationFormAttribute('cart/add', name, { enhance: '' });
                    },
                    method: 'post',
                  }
                : null;
            },
          },
          type: 'submit',
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        // SPEC.md §14: build-skew mutation data is not merged into the stale document.
        expect(target.insertAdjacentHTML).not.toHaveBeenCalled();
        expect(reload).toHaveBeenCalledTimes(1);
      } finally {
        Object.assign(globalRecord, {
          CustomEvent: originals.CustomEvent,
          FormData: originals.FormData,
          addEventListener: originals.addEventListener,
          document: originals.document,
          dispatchEvent: originals.dispatchEvent,
          fetch: originals.fetch,
          location: originals.location,
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
    'does not dispatch partial inline stream query truth on failure through %s',
    async (_name, installSource) => {
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        CustomEvent: globalRecord.CustomEvent,
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
      const dispatched: unknown[] = [];
      const encoder = new TextEncoder();
      const streamTargetAttrs = new Map<string, string>();
      const streamTarget = {
        textContent: '',
        getAttribute() {
          return null;
        },
        setAttribute(name: string, value: string) {
          streamTargetAttrs.set(name, value);
        },
      };
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                '<kovo-query name="cart">{"count":99}</kovo-query>',
                '<kovo-text target="assistant:a1">partial</kovo-text>',
                '<kovo-done reason="error"></kovo-done>',
              ].join(''),
            ),
          );
          controller.close();
        },
      });

      try {
        globalRecord.CustomEvent = class CustomEvent {
          type: string;

          constructor(type: string) {
            this.type = type;
          }
        };
        globalRecord.FormData = function FormData() {
          return {};
        };
        globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
          listeners.set(type, listener);
        };
        globalRecord.dispatchEvent = (event: unknown) => {
          dispatched.push(event);
          return true;
        };
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
        globalRecord.fetch = vi.fn(async () =>
          mutationResponse('/_m/chat/send', { body, status: 200 }),
        );

        installSource(
          vi.fn(async () => ({})),
          globalRecord,
        );
        listeners.get('submit')?.({
          preventDefault: vi.fn(),
          target: {
            closest(selector: string) {
              return selector === 'form[enhance],form[data-enhance],form[data-mutation]'
                ? {
                    action: '/_m/chat/send',
                    getAttribute(name: string) {
                      if (name === 'data-mutation') return 'chat/send';
                      if (name === 'data-mutation-stream') return 'true';
                      if (name === 'enhance') return '';
                      return null;
                    },
                    method: 'post',
                    setAttribute: vi.fn(),
                  }
                : null;
            },
          },
          type: 'submit',
        });

        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        // SPEC.md §9.1: failed streams may show stream text as failed, but
        // must not confirm partial query truth.
        expect(dispatched).toEqual([]);
        expect(streamTarget.textContent).toBe('partial');
        expect(streamTargetAttrs.get('data-stream-state')).toBe('error');
      } finally {
        Object.assign(globalRecord, {
          CustomEvent: originals.CustomEvent,
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
