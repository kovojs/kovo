import { describe, expect, it } from 'vitest';

import {
  BLOCKED_ACTIVE_EMBED_ELEMENT_NAMES,
  BLOCKED_SVG_SMIL_ELEMENT_NAMES,
  ELEMENT_CONTEXT_SECURITY_CONTROL_TUPLES,
} from '@kovojs/core/internal/sink-policy';

import {
  dispatchInlineDelegatedClick,
  inlineSourceInstallCases,
} from './inline-loader-test-utils.js';

class BoundTriggerElement {
  attributes: Array<{ name: string; value: string }>;
  stateHost: BoundTriggerElement | null = null;

  constructor(
    private readonly attrs: Record<string, string>,
    readonly tagName = 'DIV',
  ) {
    this.attributes = Object.entries(attrs).map(([name, value]) => ({ name, value }));
  }

  closest(selector: string): BoundTriggerElement | null {
    if (selector === '[kovo-state]') {
      return Object.hasOwn(this.attrs, 'kovo-state') ? this : this.stateHost;
    }
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
    it(`${label}: gives every chained handler a fresh own-data state snapshot`, async () => {
      let firstCalls = 0;
      let secondCalls = 0;
      const element = new BoundTriggerElement({
        'kovo-state': '{"__proto__":{"admin":true},"nested":{"value":1}}',
        'on:click': '/c/client.js#first /c/client.js#second',
      });

      await dispatchInlineDelegatedClick(
        element,
        async () => ({
          first(_event: unknown, context: { state: Record<string, unknown> }) {
            firstCalls += 1;
            expect(Object.getPrototypeOf(context.state)).toBeNull();
            expect(Object.getPrototypeOf(context.state.nested)).toBeNull();
            expect(Object.hasOwn(context.state, '__proto__')).toBe(true);
            expect(context.state.toString).toBeUndefined();
            expect(context.state.constructor).toBeUndefined();
            expect((context.state['__proto__'] as Record<string, unknown>).admin).toBe(true);
            context.state = { count: 2 };
          },
          second(_event: unknown, context: { state: Record<string, unknown> }) {
            secondCalls += 1;
            expect(Object.getPrototypeOf(context.state)).toBeNull();
            expect(context.state.constructor).toBeUndefined();
            context.state.count = 3;
          },
        }),
        installSource,
        ['/c/client.js'],
      );

      expect(firstCalls).toBe(1);
      expect(secondCalls).toBe(1);
      expect(element.getAttribute('kovo-state')).toBe('{"count":3}');
    });

    it(`${label}: never assimilates a synchronous handler return as a thenable`, async () => {
      let secondCalls = 0;
      let thenCalls = 0;
      const element = new BoundTriggerElement({
        'kovo-state': '{"count":0}',
        'on:click': '/c/client.js#first /c/client.js#second',
      });

      await dispatchInlineDelegatedClick(
        element,
        async () => ({
          first(_event: unknown, context: { state: { count: number } }) {
            context.state.count += 1;
            return {
              then() {
                thenCalls += 1;
                throw new Error('handler thenable executed');
              },
            };
          },
          second(_event: unknown, context: { state: { count: number } }) {
            secondCalls += 1;
            context.state.count += 1;
          },
        }),
        installSource,
        ['/c/client.js'],
      );

      expect(thenCalls).toBe(0);
      expect(secondCalls).toBe(1);
      expect(element.getAttribute('kovo-state')).toBe('{"count":2}');
    });

    it(`${label}: serializes same-island state before a gated module import`, async () => {
      let releaseFirstImport: (() => void) | undefined;
      const firstImportCanFinish = new Promise<void>((resolve) => {
        releaseFirstImport = resolve;
      });
      let importCalls = 0;
      const observations: number[] = [];
      const element = new BoundTriggerElement({
        'kovo-state': '{"count":0}',
        'on:click': '/c/client.js#increment',
      });

      const pending = dispatchInlineDelegatedClick(
        element,
        async () => {
          importCalls += 1;
          if (importCalls === 1) await firstImportCanFinish;
          return {
            increment(_event: unknown, context: { state: { count: number } }) {
              observations.push(context.state.count);
              context.state.count += 1;
            },
          };
        },
        installSource,
        ['/c/client.js'],
        undefined,
        2,
      );

      await Promise.resolve();
      expect(importCalls).toBe(1);
      releaseFirstImport?.();
      await pending;

      expect(observations).toEqual([0, 1]);
      expect(element.getAttribute('kovo-state')).toBe('{"count":2}');
    });

    it(`${label}: keeps queued state pinned when the event target moves to another host`, async () => {
      let releaseFirstImport: (() => void) | undefined;
      const firstImportCanFinish = new Promise<void>((resolve) => {
        releaseFirstImport = resolve;
      });
      let importCalls = 0;
      const observations: number[] = [];
      const selectedHost = new BoundTriggerElement({ 'kovo-state': '{"count":0}' });
      const movedHost = new BoundTriggerElement({ 'kovo-state': '{"count":99}' });
      const element = new BoundTriggerElement({ 'on:click': '/c/client.js#move' });
      element.stateHost = selectedHost;

      const pending = dispatchInlineDelegatedClick(
        element,
        async () => {
          importCalls += 1;
          if (importCalls === 1) await firstImportCanFinish;
          return {
            move(_event: unknown, context: { state: { count: number } }) {
              observations.push(context.state.count);
              context.state.count += 1;
              if (observations.length === 1) element.stateHost = movedHost;
            },
          };
        },
        installSource,
        ['/c/client.js'],
        undefined,
        2,
      );

      await Promise.resolve();
      expect(importCalls).toBe(1);
      releaseFirstImport?.();
      await pending;

      expect(observations).toEqual([0, 1]);
      expect(selectedHost.getAttribute('kovo-state')).toBe('{"count":2}');
      expect(movedHost.getAttribute('kovo-state')).toBe('{"count":99}');
    });

    it(`${label}: commits newly created state to a handler element without an initial state stamp`, async () => {
      const element = new BoundTriggerElement({
        'on:click': '/c/client.js#initialize',
      });

      await dispatchInlineDelegatedClick(
        element,
        async () => ({
          initialize(_event: unknown, context: { state: Record<string, unknown> }) {
            context.state.count = 1;
          },
        }),
        installSource,
        ['/c/client.js'],
      );

      expect(element.getAttribute('kovo-state')).toBe('{"count":1}');
    });

    it(`${label}: re-reads handler refs after a queued predecessor changes them`, async () => {
      let releaseFirstImport: (() => void) | undefined;
      const firstImportCanFinish = new Promise<void>((resolve) => {
        releaseFirstImport = resolve;
      });
      let importCalls = 0;
      let handlerCalls = 0;
      const element = new BoundTriggerElement({
        'kovo-state': '{"count":0}',
        'on:click': '/c/client.js#increment',
      });

      const pending = dispatchInlineDelegatedClick(
        element,
        async () => {
          importCalls += 1;
          if (importCalls === 1) await firstImportCanFinish;
          return {
            increment(_event: unknown, context: { state: { count: number } }) {
              handlerCalls += 1;
              context.state.count += 1;
              element.removeAttribute('on:click');
            },
          };
        },
        installSource,
        ['/c/client.js'],
        undefined,
        2,
      );

      await Promise.resolve();
      expect(importCalls).toBe(1);
      releaseFirstImport?.();
      await pending;

      expect(handlerCalls).toBe(1);
      expect(importCalls).toBe(1);
      expect(element.getAttribute('kovo-state')).toBe('{"count":1}');
    });

    it(`${label}: fails closed before a later handler can observe invalid state`, async () => {
      let accessorCalls = 0;
      const invalidStateFactories: Array<[string, () => unknown]> = [
        ['function', () => () => undefined],
        ['class instance', () => new Date()],
        ['undefined', () => undefined],
        ['BigInt', () => 1n],
        ['non-finite number', () => Number.POSITIVE_INFINITY],
        [
          'accessor',
          () => {
            const value = {};
            Object.defineProperty(value, 'secret', {
              enumerable: true,
              get() {
                accessorCalls += 1;
                return 'secret';
              },
            });
            return value;
          },
        ],
        ['sparse array', () => new Array(1)],
        [
          'cycle',
          () => {
            const value: Record<string, unknown> = {};
            value.self = value;
            return value;
          },
        ],
        [
          'deep graph',
          () => {
            let value: Record<string, unknown> = {};
            for (let depth = 0; depth < 65; depth += 1) value = { child: value };
            return value;
          },
        ],
        ['value budget', () => Array.from({ length: 10_000 }, () => 0)],
        ['text budget', () => 'x'.repeat(1_000_001)],
        [
          'hostile proxy',
          () =>
            new Proxy(
              {},
              {
                ownKeys() {
                  throw new Error('hostile ownKeys trap');
                },
              },
            ),
        ],
      ];

      for (const [invalidLabel, createInvalidState] of invalidStateFactories) {
        accessorCalls = 0;
        let secondCalls = 0;
        const element = new BoundTriggerElement({
          'kovo-state': '{"safe":true}',
          'on:click': '/c/client.js#first /c/client.js#second',
        });

        await expect(
          dispatchInlineDelegatedClick(
            element,
            async () => ({
              first(_event: unknown, context: { state: unknown }) {
                context.state = createInvalidState();
              },
              second() {
                secondCalls += 1;
              },
            }),
            installSource,
            ['/c/client.js'],
          ),
          invalidLabel,
        ).rejects.toThrow('KV449: handler state must be bounded recursive own-data JsonValue.');
        expect(secondCalls, invalidLabel).toBe(0);
        expect(element.getAttribute('kovo-state'), invalidLabel).toBe('{"safe":true}');
        expect(accessorCalls, invalidLabel).toBe(0);
      }
    });

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
            ['/c/client.js'],
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
      expect(plainModulepreload.error).toEqual(
        new Error('Disallowed Kovo dynamic import URL: /c/lazy.js'),
      );
      expect(plainModulepreload.importCalls).toEqual([]);

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
        ['/c/client.js'],
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

    it(`${label}: applies only compiler-marked reactive trusted URL writes`, async () => {
      for (const tagName of ['IMG', 'SCRIPT'] as const) {
        const element = new BoundTriggerElement(
          {
            'data-bind:src': 'state.url',
            'data-kovo-trusted-url:src': '',
            'kovo-state': '{"url":"/safe.js"}',
            'on:click': '/c/client.js#setReviewedUrl',
          },
          tagName,
        );

        await dispatchInlineDelegatedClick(
          element,
          async () => ({
            setReviewedUrl(_event: unknown, context: { state: { url: string } }) {
              context.state.url = 'javascript:reviewed()';
            },
          }),
          installSource,
          ['/c/client.js'],
        );

        expect(element.getAttribute('src'), tagName).toBe('javascript:reviewed()');
      }
    });

    // @kovo-security-certifies C13 inline-dynamic-control-plane-runtime-floor
    it(`${label}: removes state-selected compiler control-plane attributes`, async () => {
      const element = new BoundTriggerElement({
        'aria-label': 'old',
        'data-bind:aria-label': 'state.label',
        'data-bind:data-kovo-deferred-style': 'state.promoteStyle',
        'data-bind:data-kovo-module-allowlist': 'state.module',
        'data-bind:data-mutation': 'state.mutation',
        'data-bind:data-stream-renderer': 'state.renderer',
        'data-bind:on:click': 'state.handler',
        'data-kovo-deferred-style': '',
        'data-kovo-module-allowlist': '/c/client.js',
        'data-mutation': 'account/delete',
        'data-stream-renderer': '/c/victim.client.js#render',
        'kovo-state':
          '{"handler":"/c/attacker.client.js#run","label":"Ready","module":"/c/attacker.client.js","mutation":"account/delete","promoteStyle":true,"renderer":"/c/attacker.client.js#render"}',
        'on:click': '/c/client.js#commitReserved',
      });

      await dispatchInlineDelegatedClick(
        element,
        async () => ({ commitReserved() {} }),
        installSource,
        ['/c/client.js'],
      );

      expect(element.getAttribute('data-kovo-deferred-style')).toBeNull();
      expect(element.getAttribute('data-kovo-module-allowlist')).toBeNull();
      expect(element.getAttribute('data-mutation')).toBeNull();
      expect(element.getAttribute('data-stream-renderer')).toBeNull();
      expect(element.getAttribute('on:click')).toBeNull();
      expect(element.getAttribute('aria-label')).toBe('Ready');
    });

    it(`${label}: removes pair-dependent base and meta-refresh binding transitions`, async () => {
      const cases = [
        {
          attributes: {
            'data-bind:href': 'state.value',
            href: '/safe/',
            'kovo-state': '{"value":"https://attacker.example/"}',
            'on:click': '/c/client.js#commit',
          },
          blocked: 'href',
          tagName: 'BASE',
        },
        {
          attributes: {
            content: 'safe',
            'data-bind:content': 'state.value',
            'http-equiv': 'ReFrEsH',
            'kovo-state': '{"value":"0; url=https://attacker.example/collect"}',
            'on:click': '/c/client.js#commit',
          },
          blocked: 'content',
          tagName: 'META',
        },
        {
          attributes: {
            content: '0; url=https://attacker.example/collect',
            'data-bind:http-equiv': 'state.value',
            'kovo-state': '{"value":" refresh "}',
            'on:click': '/c/client.js#commit',
          },
          blocked: 'http-equiv',
          tagName: 'META',
        },
      ] as const;

      for (const testCase of cases) {
        const element = new BoundTriggerElement({ ...testCase.attributes }, testCase.tagName);
        await dispatchInlineDelegatedClick(element, async () => ({ commit() {} }), installSource, [
          '/c/client.js',
        ]);
        expect(element.getAttribute(testCase.blocked), testCase.tagName).toBeNull();
      }
    });

    it(`${label}: enforces the exact finite browser-control denominator on live writes`, async () => {
      expect(ELEMENT_CONTEXT_SECURITY_CONTROL_TUPLES).toHaveLength(67);

      for (let index = 0; index < ELEMENT_CONTEXT_SECURITY_CONTROL_TUPLES.length; index += 1) {
        const [tagName, attribute, , staticPolicy] =
          ELEMENT_CONTEXT_SECURITY_CONTROL_TUPLES[index]!;
        const current =
          staticPolicy === 'referrer-policy'
            ? 'strict-origin'
            : staticPolicy === 'target-keyword'
              ? '_blank'
              : staticPolicy === 'rel-no-opener'
                ? 'noopener noreferrer'
                : staticPolicy === 'iframe-sandbox-tokens'
                  ? 'allow-forms'
                  : staticPolicy === 'meta-referrer-name'
                    ? 'description'
                    : staticPolicy === 'meta-refresh-http-equiv'
                      ? 'content-type'
                      : `reviewed-${index}`;
        const element = new BoundTriggerElement(
          {
            ...(tagName === 'iframe' && attribute !== 'sandbox' ? { sandbox: 'allow-forms' } : {}),
            [attribute]: current,
            [`data-bind:${attribute}`]: 'state.value',
            'kovo-state': '{"value":"attacker-selected"}',
            'on:click': '/c/client.js#commit',
          },
          tagName.toUpperCase(),
        );
        await dispatchInlineDelegatedClick(element, async () => ({ commit() {} }), installSource, [
          '/c/client.js',
        ]);
        expect(element.getAttribute(attribute), `${tagName}[${attribute}]`).toBe(
          staticPolicy === 'disabled' ? null : current,
        );
      }
    });

    it(`${label}: strips an iframe source without the finite reviewed sandbox posture`, async () => {
      for (const [sandbox, expectedSource] of [
        [undefined, null],
        ['allow-scripts allow-same-origin', null],
        ['allow-top-navigation-by-user-activation', null],
        ['allow-popups-to-escape-sandbox', null],
        ['allow-storage-access-by-user-activation', null],
        ['allow-scripts', '/reviewed'],
      ] as const) {
        const element = new BoundTriggerElement(
          {
            ...(sandbox === undefined ? {} : { sandbox }),
            src: '/reviewed',
            'data-bind:title': 'state.title',
            'kovo-state': '{"title":"updated"}',
            'on:click': '/c/client.js#commitFrame',
          },
          'IFRAME',
        );
        await dispatchInlineDelegatedClick(
          element,
          async () => ({ commitFrame() {} }),
          installSource,
          ['/c/client.js'],
        );
        expect(element.getAttribute('src'), sandbox ?? 'missing').toBe(expectedSource);
        if (expectedSource === null) expect(element.getAttribute('sandbox')).toBeNull();
      }
    });

    it(`${label}: inerts unsandboxable active embeds before a live write`, async () => {
      for (const tagName of BLOCKED_ACTIVE_EMBED_ELEMENT_NAMES) {
        const activationAttribute = tagName === 'object' ? 'data' : 'src';
        const element = new BoundTriggerElement(
          {
            [activationAttribute]: '/reviewed/file.pdf',
            [`data-bind:${activationAttribute}`]: 'state.url',
            'kovo-state': JSON.stringify({ url: '/safe/account' }),
            'on:click': '/c/client.js#commitEmbed',
            type: 'application/pdf',
          },
          tagName.toUpperCase(),
        );

        await dispatchInlineDelegatedClick(
          element,
          async () => ({ commitEmbed() {} }),
          installSource,
          ['/c/client.js'],
        );

        expect(element.attributes, tagName).toEqual([
          { name: 'kovo-state', value: JSON.stringify({ url: '/safe/account' }) },
        ]);
      }
    });

    it(`${label}: strips declarative Shadow DOM controls before a live write`, async () => {
      const state = { clonable: true, mode: 'closed', serializable: true };
      const element = new BoundTriggerElement(
        {
          'data-bind:shadowrootmode': 'state.mode',
          'data-bind:ShadowRootClonable': 'state.clonable',
          'data-derive': 'state.serializable',
          'data-derive-attr': 'ShadowRootSerializable',
          'kovo-state': JSON.stringify(state),
          'on:click': '/c/client.js#commitShadow',
          shadowRootDelegatesFocus: '',
          shadowrootmode: 'open',
          title: 'ordinary inert template',
        },
        'TEMPLATE',
      );

      await dispatchInlineDelegatedClick(
        element,
        async () => ({ commitShadow() {} }),
        installSource,
        ['/c/client.js'],
      );

      expect(element.attributes).toEqual([
        { name: 'data-derive', value: 'state.serializable' },
        { name: 'kovo-state', value: JSON.stringify(state) },
        { name: 'on:click', value: '/c/client.js#commitShadow' },
        { name: 'title', value: 'ordinary inert template' },
      ]);
    });

    it(`${label}: H12 inerts SMIL target/value bindings in either transition order`, async () => {
      const payload = "javascript:(document.body.dataset.kovoSmilXss='inline',void 0)";
      for (const [index, transfer] of ['values', 'from', 'to', 'by'].entries()) {
        for (const targetFirst of [true, false]) {
          const bindings = targetFirst
            ? {
                'data-bind:attributeName': 'state.target',
                [`data-bind:${transfer}`]: 'state.payload',
              }
            : {
                [`data-bind:${transfer}`]: 'state.payload',
                'data-bind:attributeName': 'state.target',
              };
          const element = new BoundTriggerElement(
            {
              ATTRIBUTENAME: targetFirst ? 'opacity' : 'href',
              [transfer]: targetFirst ? '0;1' : payload,
              ...bindings,
              'kovo-state': JSON.stringify({ payload, target: 'xlink:href' }),
              'on:click': '/c/client.js#commitSmil',
            },
            index % 2 === 0 ? 'animate' : 'SET',
          );

          await dispatchInlineDelegatedClick(
            element,
            async () => ({ commitSmil() {} }),
            installSource,
            ['/c/client.js'],
          );

          expect(
            element.attributes,
            `${transfer}/${targetFirst ? 'target-first' : 'value-first'}`,
          ).toEqual([
            { name: 'kovo-state', value: JSON.stringify({ payload, target: 'xlink:href' }) },
          ]);
        }
      }

      for (const tagName of BLOCKED_SVG_SMIL_ELEMENT_NAMES) {
        const element = new BoundTriggerElement(
          {
            attributeName: 'opacity',
            'data-bind:values': 'state.payload',
            'kovo-state': JSON.stringify({ payload: '0;1' }),
            'on:click': '/c/client.js#commitSmil',
            values: '0;1',
          },
          tagName.toUpperCase(),
        );
        await dispatchInlineDelegatedClick(
          element,
          async () => ({ commitSmil() {} }),
          installSource,
          ['/c/client.js'],
        );
        expect(element.attributes, tagName).toEqual([
          { name: 'kovo-state', value: JSON.stringify({ payload: '0;1' }) },
        ]);
      }
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
        ['/c/client.js'],
      );

      // A relative URL with a colon in a path segment must NOT be neutralized.
      expect(element.getAttribute('href')).toBe('archive/2024:summary');
    });

    it(`${label}: still neutralizes javascript: even after uu regex fix (bugz L4 parity)`, async () => {
      // Regression guard: the tightened uu regex must not loosen the dangerous-scheme block.
      const originalReplace = String.prototype.replace;
      const originalToLowerCase = String.prototype.toLowerCase;
      const originalRegExpTest = RegExp.prototype.test;
      const element = new BoundTriggerElement({
        'data-bind:href': 'state.url',
        'kovo-state': '{"url":"/safe"}',
        'on:click': '/c/client.js#setJavaScriptUrl',
      });

      try {
        await dispatchInlineDelegatedClick(
          element,
          async () => ({
            setJavaScriptUrl(_event: unknown, context: { state: { url: string } }) {
              context.state.url = 'javascript:alert(1)';
              // Authored handlers run before the binding commit in the shared realm. These
              // conditional poisons used to make uu() accept the dangerous scheme.
              String.prototype.replace = function poisonedReplace(search, replacement) {
                if (this.valueOf() === context.state.url) return '';
                return Reflect.apply(originalReplace, this, [search, replacement]);
              };
              String.prototype.toLowerCase = function poisonedLower() {
                if (this.valueOf() === context.state.url) return '';
                return Reflect.apply(originalToLowerCase, this, []);
              };
              RegExp.prototype.test = () => false;
            },
          }),
          installSource,
          ['/c/client.js'],
        );
      } finally {
        String.prototype.replace = originalReplace;
        String.prototype.toLowerCase = originalToLowerCase;
        RegExp.prototype.test = originalRegExpTest;
      }

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
        ['/c/client.js'],
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
          selector === '[data-kovo-module-allowlist]'
            ? (options.allowlistHrefs ?? [])
            : selector === 'link[rel~="modulepreload"][href]'
              ? (options.modulepreloadHrefs ?? [])
              : [];
        return hrefs.map((href) => ({
          getAttribute(name: string) {
            return name === 'data-kovo-module-allowlist' ? href : null;
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
