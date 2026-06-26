import { describe, expect, it } from 'vitest';

import {
  dispatchInlineDelegatedClick,
  inlineSourceInstallCases,
} from './inline-loader-test-utils.js';

class BoundTriggerElement {
  attributes: Array<{ name: string; value: string }>;

  constructor(private readonly attrs: Record<string, string>) {
    this.attributes = Object.entries(attrs).map(([name, value]) => ({ name, value }));
  }

  closest(selector: string): BoundTriggerElement | null {
    if (selector === '[kovo-state]') return Object.hasOwn(this.attrs, 'kovo-state') ? this : null;
    const trigger = /^\[on\\:(.+)\]$/.exec(selector)?.[1];
    return trigger && Object.hasOwn(this.attrs, `on:${trigger}`) ? this : null;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  querySelectorAll(): unknown[] {
    return [];
  }

  removeAttribute(name: string): void {
    delete this.attrs[name];
    this.attributes = this.attributes.filter((attribute) => attribute.name !== name);
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
    const attr = this.attributes.find((attribute) => attribute.name === name);
    if (attr) attr.value = value;
    else this.attributes.push({ name, value });
  }
}

describe('inline loader output security', () => {
  for (const [label, installSource] of inlineSourceInstallCases) {
    it(`${label}: applies boolean-presence data-bind false/null/true parity`, async () => {
      for (const name of ['hidden', 'disabled', 'checked'] as const) {
        for (const value of [false, null, true]) {
          const element = new BoundTriggerElement({
            [name]: '',
            [`data-bind:${name}`]: 'state.value',
            'kovo-state': JSON.stringify({ value }),
            'on:click': '/c/client.js#setPresence',
          }) as BoundTriggerElement & { checked?: boolean };
          element.checked = true;

          await dispatchInlineDelegatedClick(
            element,
            async () => ({
              setPresence() {},
            }),
            installSource,
          );

          expect(element.getAttribute(name)).toBe(value === true ? '' : null);
          if (name === 'checked') expect(element.checked).toBe(value === true);
        }
      }
    });

    it(`${label}: keeps dynamic import guard parity for dev, /c/, and allowlist paths`, async () => {
      const productionUpload = await dispatchInlineGuardPath({
        href: 'https://kovo.test/admin/upload.ts#noop',
        installSource,
        origin: 'https://kovo.test',
      });
      expect(productionUpload.error).toEqual(
        new Error('Disallowed Kovo dynamic import URL: https://kovo.test/admin/upload.ts'),
      );
      expect(productionUpload.importCalls).toEqual([]);

      const productionAsset = await dispatchInlineGuardPath({
        href: 'https://kovo.test/assets#noop',
        installSource,
        origin: 'https://kovo.test',
      });
      expect(productionAsset.error).toEqual(
        new Error('Disallowed Kovo dynamic import URL: https://kovo.test/assets'),
      );
      expect(productionAsset.importCalls).toEqual([]);

      const localhostTsx = await dispatchInlineGuardPath({
        href: '/admin/upload.tsx#noop',
        installSource,
        origin: 'http://localhost:5173',
      });
      expect(localhostTsx.error).toBeUndefined();
      expect(localhostTsx.importCalls).toEqual(['/admin/upload.tsx']);

      const plainModulepreload = await dispatchInlineGuardPath({
        href: '/c/lazy.js#noop',
        installSource,
        modulepreloadHrefs: ['/c/eager.js'],
        origin: 'https://kovo.test',
      });
      expect(plainModulepreload.error).toBeUndefined();
      expect(plainModulepreload.importCalls).toEqual(['/c/lazy.js']);

      const manifestAllowed = await dispatchInlineGuardPath({
        href: '/c/allowed.js?v=1#noop',
        allowlistHrefs: ['/c/allowed.js?v=1'],
        installSource,
        origin: 'https://kovo.test',
      });
      expect(manifestAllowed.error).toBeUndefined();
      expect(manifestAllowed.importCalls).toEqual(['/c/allowed.js?v=1']);

      const manifestRejected = await dispatchInlineGuardPath({
        href: '/c/other.js#noop',
        allowlistHrefs: ['/c/allowed.js?v=1'],
        installSource,
        origin: 'https://kovo.test',
      });
      expect(manifestRejected.error).toEqual(
        new Error('Disallowed Kovo dynamic import URL: /c/other.js'),
      );
      expect(manifestRejected.importCalls).toEqual([]);
    });

    it(`${label}: neutralizes unsafe data-bind URL attribute writes`, async () => {
      const element = new BoundTriggerElement({
        'data-bind:action': 'state.url',
        'data-bind:data': 'state.url',
        'data-bind:href': 'state.url',
        'data-bind:ping': 'state.url',
        'data-bind:poster': 'state.url',
        'data-bind:src': 'state.url',
        'data-bind:srcset': 'state.srcset',
        'data-bind:style': 'state.style',
        'data-bind:xlink:href': 'state.url',
        'kovo-state': '{"url":"/safe","srcset":"/safe.png 1x","style":"color:red"}',
        'on:click': '/c/client.js#setUnsafeUrl',
      });

      await dispatchInlineDelegatedClick(
        element,
        async () => ({
          setUnsafeUrl(_event: unknown, context: { state: { url: string } }) {
            context.state.url = 'javascript:alert(1)';
            (context.state as { srcset: string }).srcset = '/safe.png 1x, javascript:alert(1) 2x';
            (context.state as { style: string }).style = 'background:url(javascript:alert(1))';
          },
        }),
        installSource,
      );

      expect(element.getAttribute('action')).toBe('#');
      expect(element.getAttribute('data')).toBe('#');
      expect(element.getAttribute('href')).toBe('#');
      expect(element.getAttribute('ping')).toBe('#');
      expect(element.getAttribute('poster')).toBe('#');
      expect(element.getAttribute('src')).toBe('#');
      expect(element.getAttribute('srcset')).toBe('/safe.png 1x');
      expect(element.getAttribute('style')).toBeNull();
      expect(element.getAttribute('xlink:href')).toBe('#');
    });

    it(`${label}: preserves relative URLs with a colon in a path segment (bugz L4 uu regex parity)`, async () => {
      // SPEC.md §4.5/§4.8 KV236: the inline uu() scheme check must use the same
      // canonical regex as core/internal/security-url.ts — /^[a-z][a-z0-9+.-]*:/ —
      // so that relative URLs like "archive/2024:summary" or "a/b:c" (colon after
      // a slash, not a valid scheme) are NOT mistaken for dangerous schemes and NOT
      // rewritten to '#'.  Dangerous schemes (javascript:, vbscript:, data:) must
      // still be neutralized.
      const element = new BoundTriggerElement({
        'data-bind:href': 'state.url',
        'kovo-state': '{"url":"/safe"}',
        'on:click': '/c/client.js#setRelativeColonUrl',
      });

      await dispatchInlineDelegatedClick(
        element,
        async () => ({
          setRelativeColonUrl(_event: unknown, context: { state: { url: string } }) {
            context.state.url = 'archive/2024:summary';
          },
        }),
        installSource,
      );

      // A relative URL with a colon in a path segment must NOT be neutralized.
      expect(element.getAttribute('href')).toBe('archive/2024:summary');
    });

    it(`${label}: still neutralizes javascript: even after uu regex fix (bugz L4 parity)`, async () => {
      // Regression guard: the tightened uu regex must not loosen the dangerous-scheme block.
      const element = new BoundTriggerElement({
        'data-bind:href': 'state.url',
        'kovo-state': '{"url":"/safe"}',
        'on:click': '/c/client.js#setJavaScriptUrl',
      });

      await dispatchInlineDelegatedClick(
        element,
        async () => ({
          setJavaScriptUrl(_event: unknown, context: { state: { url: string } }) {
            context.state.url = 'javascript:alert(1)';
          },
        }),
        installSource,
      );

      // javascript: is a real scheme (matches /^[a-z][a-z0-9+.-]*:/) and not in the allowlist.
      expect(element.getAttribute('href')).toBe('#');
    });

    it(`${label}: suppresses unsafe on*, srcdoc, and raw HTML data-bind attribute writes`, async () => {
      const element = new BoundTriggerElement({
        'data-bind:innerHTML': 'state.html',
        'data-bind:onclick': 'state.handler',
        'data-bind:srcdoc': 'state.srcdoc',
        innerHTML: '<p>old</p>',
        'kovo-state':
          '{"handler":"alert(1)","html":"<img src=x onerror=alert(1)>","srcdoc":"<script>alert(1)</script>"}',
        'on:click': '/c/client.js#noop',
      });

      await dispatchInlineDelegatedClick(
        element,
        async () => ({
          noop() {},
        }),
        installSource,
      );

      expect(element.getAttribute('innerHTML')).toBeNull();
      expect(element.getAttribute('onclick')).toBeNull();
      expect(element.getAttribute('srcdoc')).toBeNull();
    });
  }
});

async function dispatchInlineGuardPath(options: {
  allowlistHrefs?: readonly string[];
  href: string;
  installSource: (typeof inlineSourceInstallCases)[number][1];
  modulepreloadHrefs?: readonly string[];
  origin: string;
}): Promise<{ error?: unknown; importCalls: string[] }> {
  const globalRecord = globalThis as unknown as Record<string, unknown>;
  const originals = {
    addEventListener: globalRecord.addEventListener,
    document: globalRecord.document,
    importModule: globalRecord.__kovoInlineImport,
    location: globalRecord.location,
  };
  const listeners = new Map<string, (event: unknown) => Promise<void>>();
  const element = new BoundTriggerElement({
    'kovo-state': '{}',
    'on:click': options.href,
  });
  const importCalls: string[] = [];

  try {
    globalRecord.addEventListener = (type: string, listener: (event: unknown) => Promise<void>) => {
      listeners.set(type, listener);
    };
    globalRecord.document = {
      querySelectorAll(selector: string) {
        const hrefs =
          selector === 'link[data-kovo-module-allowlist][rel~="modulepreload"][href]'
            ? (options.allowlistHrefs ?? [])
            : selector === 'link[rel~="modulepreload"][href]'
              ? (options.modulepreloadHrefs ?? [])
              : [];
        return hrefs.map((href) => ({
          getAttribute(name: string) {
            return name === 'href' ? href : null;
          },
        }));
      },
    };
    globalRecord.location = {
      href: `${options.origin}/current`,
      origin: options.origin,
    };

    options.installSource(async (url: string) => {
      importCalls.push(url);
      return { noop() {} };
    }, globalRecord);

    await listeners.get('click')?.({ target: element, type: 'click' });
    return { importCalls };
  } catch (error) {
    return { error, importCalls };
  } finally {
    Object.assign(globalRecord, {
      addEventListener: originals.addEventListener,
      document: originals.document,
      location: originals.location,
    });
    if (originals.importModule === undefined) {
      delete globalRecord.__kovoInlineImport;
    } else {
      globalRecord.__kovoInlineImport = originals.importModule;
    }
  }
}
