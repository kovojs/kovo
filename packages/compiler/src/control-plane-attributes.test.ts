// @kovo-security-classifier-corpus framework-control-plane-attribute-denominator
import {
  GENERATED_ONLY_SEMANTIC_ATTRIBUTES,
  GENERATED_ONLY_SEMANTIC_ATTRIBUTE_PREFIXES,
  isGeneratedOnlySemanticAttribute,
} from '@kovojs/core/internal/semantic-attributes';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const generatedControlAttributes = [
  'data-enhance',
  'data-key',
  'data-kovo-critical-href',
  'data-kovo-csp-hash',
  'data-kovo-deferred-style',
  'data-kovo-native-fallback',
  'data-kovo-stream',
  'data-mutation',
  'data-mutation-stream',
  'data-plan',
  'data-stream',
  'data-stream-state',
  'data-stream-text',
  'enhance',
  'kovo-live-token',
  'kovo-nav-components',
  'kovo-nav-kind',
  'kovo-nav-name',
  'kovo-nav-queries',
  'kovo-nav-segment',
  'kovo-query',
  'kovo-stamp',
] as const;

describe('SPEC §4.8/§5.2 browser control-plane attribute denominator', () => {
  // @kovo-security-certifies C13 generated-control-plane-selector-denominator
  it('classifies every single-attribute runtime control as compiler/framework generated', () => {
    for (const name of generatedControlAttributes) {
      expect(isGeneratedOnlySemanticAttribute(name), name).toBe(true);
    }

    expect(GENERATED_ONLY_SEMANTIC_ATTRIBUTES).toEqual(
      expect.arrayContaining(generatedControlAttributes),
    );
    expect(GENERATED_ONLY_SEMANTIC_ATTRIBUTE_PREFIXES).toEqual(
      expect.arrayContaining(['data-bind:', 'data-bind-prop:', 'data-p-', 'on:']),
    );
  });

  it('mechanically pins every production browser/inline consumer to the shared denominator', () => {
    const consumers = [
      {
        anchors: [
          "'form[enhance],form[data-enhance],form[data-mutation]'",
          "readAttribute(form, 'data-mutation')",
        ],
        file: 'packages/browser/src/mutation-form.ts',
        names: ['enhance', 'data-enhance', 'data-mutation'],
      },
      {
        anchors: [
          "getAttribute('data-mutation-stream')",
          "getAttribute('data-stream')",
          "getAttribute('data-kovo-stream')",
        ],
        file: 'packages/browser/src/mutation-submit.ts',
        names: ['data-mutation-stream', 'data-stream', 'data-kovo-stream'],
      },
      {
        anchors: [
          "readRuntimeElementAttribute(target, 'data-stream-renderer')",
          '`[data-stream-text="${escapeCssString(target)}"]`',
          "setRuntimeElementAttribute(target, 'data-stream-state', 'streaming')",
        ],
        file: 'packages/browser/src/stream-text.ts',
        names: ['data-stream-renderer', 'data-stream-text', 'data-stream-state'],
      },
      {
        anchors: [
          "ras(el, 'kovo-live-token')",
          "bns.readAttribute(el, 'data-kovo-critical-href')",
          "'link[data-kovo-deferred-style]'",
          "'script[data-kovo-csp-hash]'",
          "bns.readAttribute(form, 'data-kovo-native-fallback')",
        ],
        file: 'packages/browser/src/inline-loader-build.ts',
        names: [
          'kovo-live-token',
          'data-kovo-critical-href',
          'data-kovo-deferred-style',
          'data-kovo-csp-hash',
          'data-kovo-native-fallback',
        ],
      },
      {
        anchors: ["element.getAttribute('kovo-live-token')"],
        file: 'packages/browser/src/mutation-targets.ts',
        names: ['kovo-live-token'],
      },
      {
        anchors: ["queryAll(doc, 'script[kovo-query]')"],
        file: 'packages/browser/src/document-lifecycle.ts',
        names: ['kovo-query'],
      },
      {
        anchors: ["security.queryOne(host, 'template[kovo-stamp]')"],
        file: 'packages/browser/src/query-bindings.ts',
        names: ['kovo-stamp'],
      },
      {
        anchors: [
          "security.readAttribute(element, 'data-key')",
          "'[kovo-key], [data-key]'",
        ],
        file: 'packages/browser/src/morph.ts',
        names: ['data-key'],
      },
      {
        anchors: [
          "'[kovo-nav-segment]'",
          "security.readAttribute(el, 'kovo-nav-kind')",
          "security.readAttribute(el, 'kovo-nav-name')",
          "security.readAttribute(el, 'kovo-nav-queries')",
          "security.readAttribute(el, 'kovo-nav-components')",
          "'script[data-kovo-csp-hash]'",
        ],
        file: 'packages/browser/src/enhanced-navigation.ts',
        names: [
          'kovo-nav-segment',
          'kovo-nav-kind',
          'kovo-nav-name',
          'kovo-nav-queries',
          'kovo-nav-components',
          'data-kovo-csp-hash',
        ],
      },
    ] as const;

    for (const consumer of consumers) {
      const source = readFileSync(`${repoRoot}${consumer.file}`, 'utf8');
      for (const anchor of consumer.anchors) expect(source, consumer.file).toContain(anchor);
      for (const name of consumer.names) {
        expect(isGeneratedOnlySemanticAttribute(name), `${consumer.file}: ${name}`).toBe(true);
      }
    }
  });

  it('documents intentionally author-semantic and pair-dependent runtime reads', () => {
    for (const name of [
      'data-error-code',
      'data-error-path',
      'data-state',
      'kovo-upload-progress',
    ]) {
      expect(isGeneratedOnlySemanticAttribute(name), name).toBe(false);
    }

    // `name`, `key`, `content`, and `target` are standard or pair-dependent attributes. A global
    // single-name ban would break ordinary HTML; their element/meta tuple checks remain separate.
    for (const name of ['content', 'key', 'name', 'target']) {
      expect(isGeneratedOnlySemanticAttribute(name), name).toBe(false);
    }
  });
});
