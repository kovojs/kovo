// @kovo-security-classifier-corpus finite-security-operation-ir
import {
  GENERATED_ONLY_SEMANTIC_ATTRIBUTES,
  GENERATED_ONLY_SEMANTIC_ATTRIBUTE_PREFIXES,
} from '@kovojs/core/internal/semantic-attributes';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  authoredKovoExecutableReferenceAttributeKind,
  kovoExecutableReferenceAttributeInventory,
  kovoExecutableReferenceAttributeKind,
} from './executable-reference-attributes.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

describe('SPEC §4.3/§5.2 executable-reference attribute inventory', () => {
  // @kovo-security-certifies C13 executable-reference-selector-denominator
  it('keeps one finite ASCII-case-normalized classifier for both compiler gates', () => {
    expect(kovoExecutableReferenceAttributeInventory).toEqual([
      { authoredPolicy: 'always', kind: 'handler', match: 'prefix', selector: 'on:' },
      { authoredPolicy: 'module-ref', kind: 'derive', match: 'exact', selector: 'data-bind' },
      { authoredPolicy: 'module-ref', kind: 'derive', match: 'prefix', selector: 'data-bind:' },
      {
        authoredPolicy: 'always',
        kind: 'derive',
        match: 'prefix',
        selector: 'data-bind-prop:',
      },
      {
        authoredPolicy: 'always',
        kind: 'stream-renderer',
        match: 'exact',
        selector: 'data-stream-renderer',
      },
      {
        authoredPolicy: 'always',
        kind: 'module-allowlist',
        match: 'exact',
        selector: 'data-kovo-module-allowlist',
      },
    ]);

    expect(kovoExecutableReferenceAttributeKind('ON:CLICK')).toBe('handler');
    expect(kovoExecutableReferenceAttributeKind('DATA-BIND:HIDDEN')).toBe('derive');
    expect(kovoExecutableReferenceAttributeKind('DATA-BIND-PROP:CHECKED')).toBe('derive');
    expect(kovoExecutableReferenceAttributeKind('DATA-STREAM-RENDERER')).toBe(
      'stream-renderer',
    );
    expect(kovoExecutableReferenceAttributeKind('DATA-KOVO-MODULE-ALLOWLIST')).toBe(
      'module-allowlist',
    );

    expect(authoredKovoExecutableReferenceAttributeKind('data-bind', 'cart.count')).toBeUndefined();
    expect(
      authoredKovoExecutableReferenceAttributeKind(
        'data-bind',
        '/c/cart.client.js#Cart$count',
      ),
    ).toBe('derive');
    expect(
      authoredKovoExecutableReferenceAttributeKind('data-bind-prop:checked', 'cart.checked'),
    ).toBe('derive');
  });

  it('censuses every runtime executable-selector consumer against the shared inventory', () => {
    const consumers = [
      {
        anchors: ["readRuntimeElementAttribute(element, 'on:' + eventType)"],
        file: 'packages/browser/src/handlers.ts',
        selector: 'on:click',
      },
      {
        anchors: [
          "bindingAttributes(el, 'data-bind:')",
          "bns.readAttribute(host, 'data-bind')",
          "bindingAttributes(el, 'data-bind-prop:')",
          "bns.readAttribute(el, 'data-stream-renderer')",
          "bns.readAttribute(a, 'data-kovo-module-allowlist')",
        ],
        file: 'packages/browser/src/inline-loader-build.ts',
        selector: 'data-bind',
      },
      {
        anchors: ["readRuntimeElementAttribute(target, 'data-stream-renderer')"],
        file: 'packages/browser/src/stream-text.ts',
        selector: 'data-stream-renderer',
      },
      {
        anchors: ["readModuleMarkerAttribute(marker, 'data-kovo-module-allowlist')"],
        file: 'packages/browser/src/dynamic-import-url.ts',
        selector: 'data-kovo-module-allowlist',
      },
    ] as const;

    for (const consumer of consumers) {
      expect(kovoExecutableReferenceAttributeKind(consumer.selector)).toBeDefined();
      const source = readFileSync(`${repoRoot}${consumer.file}`, 'utf8');
      for (const anchor of consumer.anchors) expect(source).toContain(anchor);
    }

    for (const row of kovoExecutableReferenceAttributeInventory) {
      const generatedOnly =
        row.match === 'exact'
          ? GENERATED_ONLY_SEMANTIC_ATTRIBUTES.includes(
              row.selector as (typeof GENERATED_ONLY_SEMANTIC_ATTRIBUTES)[number],
            )
          : GENERATED_ONLY_SEMANTIC_ATTRIBUTE_PREFIXES.includes(
              row.selector as (typeof GENERATED_ONLY_SEMANTIC_ATTRIBUTE_PREFIXES)[number],
            );
      expect(generatedOnly, `${row.selector} must remain compiler-generated lowered IR`).toBe(true);
    }
  });
});
