// @kovo-security-classifier-corpus framework-control-plane-attribute-denominator
import {
  COMPILER_OWNED_RESIDUAL_ATTRIBUTES,
  COMPILER_OWNED_RESIDUAL_ATTRIBUTE_PREFIXES,
  GENERATED_ONLY_SEMANTIC_ATTRIBUTES,
  GENERATED_ONLY_SEMANTIC_ATTRIBUTE_PREFIXES,
  isGeneratedOnlySemanticAttribute,
} from '@kovojs/core/internal/semantic-attributes';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const generatedControlAttributes = [
  'data-bind',
  'data-bind-list',
  'data-derive',
  'data-derive-attr',
  'data-enhance',
  'data-key',
  'data-kovo-critical-href',
  'data-kovo-csp-hash',
  'data-kovo-deferred-style',
  'data-kovo-module-allowlist',
  'data-kovo-native-fallback',
  'data-kovo-region-priority',
  'data-kovo-run',
  'data-kovo-stream',
  'data-kovo-style-source',
  'data-mutation',
  'data-mutation-stream',
  'data-plan',
  'data-stream',
  'data-stream-renderer',
  'data-stream-state',
  'data-stream-text',
  'enhance',
  'kovo-c',
  'kovo-deps',
  'kovo-error',
  'kovo-fragment-target',
  'kovo-i18n',
  'kovo-key',
  'kovo-live-component',
  'kovo-live-token',
  'kovo-nav-components',
  'kovo-nav-kind',
  'kovo-nav-name',
  'kovo-nav-queries',
  'kovo-nav-segment',
  'kovo-param-types',
  'kovo-pending',
  'kovo-props',
  'kovo-query',
  'kovo-stamp',
  'kovo-state',
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

  // @kovo-security-certifies C13 authored-control-plane-carrier-closure
  it('rejects every residual control through direct JSX, static spreads, and primitive attrs', () => {
    const attributes = [...COMPILER_OWNED_RESIDUAL_ATTRIBUTES];
    const direct = attributes.map((name) => `${name}="probe"`).join(' ');
    const entries = attributes.map((name) => `${JSON.stringify(name)}: 'probe'`).join(',\n');
    const carriers = [
      `<div ${direct}></div>`,
      `<div {...{${entries}}}></div>`,
      `<Primitive.Root attrs={{${entries}}}><button>Open</button></Primitive.Root>`,
    ];

    for (const carrier of carriers) {
      const result = compileComponentModule({
        fileName: 'src/authored-control-plane.tsx',
        source: `
export const AuthoredControlPlane = component({
  render: () => (${carrier}),
});
`,
      });
      const messages = result.diagnostics
        .filter((diagnostic) => diagnostic.code === 'KV235')
        .map((diagnostic) => diagnostic.message);

      for (const name of attributes) {
        expect(
          messages.some((message) => message.includes(name)),
          name,
        ).toBe(true);
      }
    }
  });

  it('rejects residual prefixes through nested primitive attrs', () => {
    const names = COMPILER_OWNED_RESIDUAL_ATTRIBUTE_PREFIXES.map((prefix) => `${prefix}probe`);
    const entries = names.map((name) => `${JSON.stringify(name)}: 'probe'`).join(',\n');
    const result = compileComponentModule({
      fileName: 'src/nested-authored-control-plane.tsx',
      source: `
export const NestedAuthoredControlPlane = component({
  render: () => (
    <Primitive.Root attrs={{ attrs: {${entries}} }}>
      <button>Open</button>
    </Primitive.Root>
  ),
});
`,
    });
    const messages = result.diagnostics
      .filter((diagnostic) => diagnostic.code === 'KV235')
      .map((diagnostic) => diagnostic.message);

    for (const name of names) {
      expect(
        messages.some((message) => message.includes(name)),
        name,
      ).toBe(true);
    }
  });

  it('mechanically pins every production browser/inline consumer to the shared denominator', () => {
    const consumers = [
      {
        anchors: [
          "'form[enhance],form[data-enhance],form[data-mutation]'",
          "readAttribute(form, 'data-mutation')",
          "setAttribute?.('kovo-error', '')",
        ],
        file: 'packages/browser/src/mutation-form.ts',
        names: ['enhance', 'data-enhance', 'data-mutation', 'kovo-error'],
      },
      {
        anchors: [
          "getAttribute('data-mutation-stream')",
          "getAttribute('data-stream')",
          "getAttribute('data-kovo-stream')",
          "form.getAttribute('kovo-deps')",
        ],
        file: 'packages/browser/src/mutation-submit.ts',
        names: ['data-mutation-stream', 'data-stream', 'data-kovo-stream', 'kovo-deps'],
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
          "ras(el, 'kovo-live-component')",
          "ras(el, 'kovo-param-types')",
          "ras(el, 'kovo-props')",
          "bns.readAttribute(el, 'kovo-state')",
          "bns.readAttribute(host, 'data-bind')",
          "'[data-kovo-module-allowlist]'",
          "bns.readAttribute(el, 'data-stream-renderer')",
          "bns.readAttribute(form, 'data-mutation-stream')",
          "bns.readAttribute(el, 'data-kovo-critical-href')",
          "'link[data-kovo-deferred-style]'",
          "'script[data-kovo-csp-hash]'",
          "bns.readAttribute(form, 'data-kovo-native-fallback')",
        ],
        file: 'packages/browser/src/inline-loader-build.ts',
        names: [
          'kovo-live-token',
          'kovo-live-component',
          'kovo-param-types',
          'kovo-props',
          'kovo-state',
          'data-bind',
          'data-kovo-module-allowlist',
          'data-stream-renderer',
          'data-mutation-stream',
          'data-kovo-critical-href',
          'data-kovo-deferred-style',
          'data-kovo-csp-hash',
          'data-kovo-native-fallback',
        ],
      },
      {
        anchors: [
          "root.querySelectorAll('[kovo-deps]')",
          "element.getAttribute('kovo-fragment-target')",
          "element.getAttribute('kovo-c')",
          "element.getAttribute('kovo-live-component')",
          "element.getAttribute('kovo-props')",
          "element.getAttribute('kovo-live-token')",
        ],
        file: 'packages/browser/src/mutation-targets.ts',
        names: [
          'kovo-deps',
          'kovo-fragment-target',
          'kovo-c',
          'kovo-live-component',
          'kovo-props',
          'kovo-live-token',
        ],
      },
      {
        anchors: ["queryAll(doc, 'script[kovo-query]')"],
        file: 'packages/browser/src/document-lifecycle.ts',
        names: ['kovo-query'],
      },
      {
        anchors: [
          "security.queryOne(host, 'template[kovo-stamp]')",
          "security.readAttribute(child, 'kovo-key')",
          "readRuntimeElementAttribute(element, 'data-bind')",
          "readRuntimeElementAttribute(closestQueryHost, 'kovo-deps')",
          '`[data-derive="${queryName}.${name}"]`',
        ],
        file: 'packages/browser/src/query-bindings.ts',
        names: ['kovo-stamp', 'kovo-key', 'data-bind', 'kovo-deps', 'data-derive'],
      },
      {
        anchors: [
          "readRuntimeElementAttribute(element, 'kovo-param-types')",
          "readRuntimeElementAttribute(stateHost, 'kovo-state')",
          "readRuntimeElementAttribute(island, 'kovo-c')",
          "readRuntimeElementAttribute(island, 'kovo-key')",
        ],
        file: 'packages/browser/src/handler-context.ts',
        names: ['kovo-param-types', 'kovo-state', 'kovo-c', 'kovo-key'],
      },
      {
        anchors: [
          "security.readAttribute(element, 'data-key')",
          "security.readAttribute(current, 'kovo-state')",
          "'[kovo-key], [data-key]'",
        ],
        file: 'packages/browser/src/morph.ts',
        names: ['data-key', 'kovo-key', 'kovo-state'],
      },
      {
        anchors: [
          "security.queryAllElements(e, '[kovo-key]')",
          "security.readAttribute(e, 'kovo-key')",
        ],
        file: 'packages/browser/src/response-fragment-apply.ts',
        names: ['kovo-key'],
      },
      {
        anchors: ["form.getAttribute?.('kovo-fragment-target')", "form.getAttribute?.('kovo-c')"],
        file: 'packages/browser/src/mutation-fetch.ts',
        names: ['kovo-fragment-target', 'kovo-c'],
      },
      {
        anchors: ["queryAllElements(document, '[data-kovo-module-allowlist]')"],
        file: 'packages/browser/src/dynamic-import-url.ts',
        names: ['data-kovo-module-allowlist'],
      },
      {
        anchors: [
          "root.querySelectorAll('[kovo-deps]')",
          "element.getAttribute('kovo-deps')",
          "element.setAttribute('kovo-pending', '')",
        ],
        file: 'packages/browser/src/pending.ts',
        names: ['kovo-deps', 'kovo-pending'],
      },
      {
        anchors: ["readRuntimeElementAttribute(script, 'kovo-query')"],
        file: 'packages/browser/src/wire-parser.ts',
        names: ['kovo-query'],
      },
      {
        anchors: ["queryAllElements(root, 'script[kovo-query]')"],
        file: 'packages/browser/src/query-visible-return.ts',
        names: ['kovo-query'],
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
      {
        anchors: [
          'el.getAttribute("kovo-fragment-target")',
          'el.getAttribute("kovo-live-component")',
          'el.getAttribute("kovo-props")',
          'el.getAttribute("kovo-live-token")',
          'el.getAttribute("kovo-deps")',
        ],
        file: 'packages/server/src/vite-dev.ts',
        names: [
          'kovo-fragment-target',
          'kovo-c',
          'kovo-live-component',
          'kovo-props',
          'kovo-live-token',
          'kovo-deps',
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

  it('mechanically discovers every production DOM Kovo attribute literal', () => {
    const files = [
      ...productionRuntimeFiles(`${repoRoot}packages/browser/src`),
      ...productionRuntimeFiles(`${repoRoot}packages/server/src`),
    ];
    const discovered = new Map<string, Set<string>>();

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const name of runtimeDomAttributeLiterals(source)) {
        const users = discovered.get(name) ?? new Set<string>();
        users.add(file.slice(repoRoot.length));
        discovered.set(name, users);
      }
    }

    const intentionallyAuthored = new Set(['kovo-upload-progress']);
    const unclassified = [...discovered]
      .filter(
        ([name]) => !isGeneratedOnlySemanticAttribute(name) && !intentionallyAuthored.has(name),
      )
      .map(([name, files]) => `${name}: ${[...files].sort().join(', ')}`)
      .sort();

    expect(unclassified).toEqual([]);
    expect([...discovered.keys()]).toEqual(
      expect.arrayContaining([
        'data-kovo-csp-hash',
        'data-mutation',
        'data-stream-text',
        'kovo-error',
        'kovo-pending',
        'kovo-upload-progress',
      ]),
    );
  });
});

function productionRuntimeFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...productionRuntimeFiles(path));
      continue;
    }
    if (
      !entry.isFile() ||
      !entry.name.endsWith('.ts') ||
      entry.name.includes('.test.') ||
      entry.name.includes('.browser.') ||
      entry.name === 'inline-loader.ts' ||
      entry.name.endsWith('-fixture.ts') ||
      entry.name.includes('test-fakes') ||
      entry.name.includes('test-utils')
    ) {
      continue;
    }
    files.push(path);
  }
  return files;
}

function runtimeDomAttributeLiterals(source: string): Set<string> {
  const names = new Set<string>();
  const candidate =
    /^(?:data-(?:kovo|bind|derive|mutation|stream|plan|key|enhance)[a-z0-9:_-]*|kovo-[a-z0-9:_-]+|enhance)$/i;
  const calls =
    /(?:getAttribute|readAttribute|readRuntimeElementAttribute|setAttribute|setElementAttribute|setRuntimeElementAttribute|removeAttribute|removeElementAttribute|hasAttribute|hasElementAttribute)\s*(?:\?\.)?\(([^)\n]*)\)/g;
  const strings = /['"]([^'"]+)['"]/g;
  const selectors = /\[\s*([a-z][a-z0-9:_-]*)/gi;

  for (const call of source.matchAll(calls)) {
    for (const literal of (call[1] ?? '').matchAll(strings)) {
      const name = literal[1]?.toLowerCase();
      if (name && candidate.test(name)) names.add(name);
    }
  }
  for (const selector of source.matchAll(selectors)) {
    const name = selector[1]?.toLowerCase();
    if (name && candidate.test(name)) names.add(name);
  }
  return names;
}
