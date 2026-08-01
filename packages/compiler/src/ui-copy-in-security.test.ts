import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { vendoredUiComponents } from '../../cli/src/add-catalog.js';
import { assertFixpoint, assertRenderEquivalence, compileComponentModule } from './index.js';

const compilerSourceDirectory = dirname(fileURLToPath(import.meta.url));
const uiSourceDirectory = resolve(compilerSourceDirectory, '../../ui/src');

interface VendoredAnchorSource {
  readonly fileName: string;
  readonly sourceFile: ts.SourceFile;
}

function vendoredAnchorSources(): VendoredAnchorSource[] {
  return readdirSync(uiSourceDirectory)
    .filter((name) => name.endsWith('.tsx') && !name.includes('.test.'))
    .sort((left, right) => left.localeCompare(right))
    .flatMap((name) => {
      const fileName = join(uiSourceDirectory, name);
      const source = readFileSync(fileName, 'utf8');
      const sourceFile = ts.createSourceFile(
        fileName,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      let hasAnchor = false;
      const visit = (node: ts.Node): void => {
        const opening = ts.isJsxElement(node)
          ? node.openingElement
          : ts.isJsxSelfClosingElement(node)
            ? node
            : null;
        if (opening?.tagName.getText(sourceFile) === 'a') hasAnchor = true;
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
      return hasAnchor ? [{ fileName, sourceFile }] : [];
    });
}

function frameworkStyleAttrsLocalNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== '@kovojs/style' ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    for (const element of statement.importClause.namedBindings.elements) {
      if ((element.propertyName ?? element.name).text === 'attrs') names.add(element.name.text);
    }
  }
  return names;
}

function copiedUiHelperPrelude(source: string): string {
  const sourceFile = ts.createSourceFile(
    'copied-ui-helper.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const helper = sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === 'passThroughProps',
  );
  if (!helper) throw new TypeError('Expected copied UI passThroughProps helper.');
  return source.slice(0, helper.getEnd());
}

describe('@kovojs/ui copy-in compiler security', () => {
  it('keeps every UI anchor on the finite style helper plus caller-prop projection shape', () => {
    const sources = vendoredAnchorSources();
    const anchors: string[] = [];
    const spreadKinds: Record<string, string[]> = {};
    const findings = sources.flatMap(({ fileName, sourceFile }) => {
      const styleAttrsNames = frameworkStyleAttrsLocalNames(sourceFile);
      const fileFindings: {
        readonly column: number;
        readonly file: string;
        readonly line: number;
      }[] = [];
      const visit = (node: ts.Node): void => {
        const opening = ts.isJsxElement(node)
          ? node.openingElement
          : ts.isJsxSelfClosingElement(node)
            ? node
            : null;
        if (opening?.tagName.getText(sourceFile) === 'a') {
          const relativeFile = fileName.slice(uiSourceDirectory.length + 1);
          anchors.push(relativeFile);
          spreadKinds[relativeFile] = [];
          for (const attribute of opening.attributes.properties) {
            if (!ts.isJsxSpreadAttribute(attribute)) continue;
            const expression = attribute.expression;
            const hasFiniteStyleShape =
              ts.isCallExpression(expression) &&
              ts.isIdentifier(expression.expression) &&
              styleAttrsNames.has(expression.expression.text);
            const hasPassThroughShape =
              ts.isCallExpression(expression) &&
              ts.isIdentifier(expression.expression) &&
              expression.expression.text === 'passThroughProps' &&
              expression.arguments.length === 1 &&
              ts.isIdentifier(expression.arguments[0]) &&
              expression.arguments[0].text === 'props';
            if (hasFiniteStyleShape || hasPassThroughShape) {
              spreadKinds[relativeFile]?.push(
                hasFiniteStyleShape ? 'style.attrs' : 'passThroughProps',
              );
              continue;
            }
            const position = sourceFile.getLineAndCharacterOfPosition(
              attribute.getStart(sourceFile),
            );
            fileFindings.push({
              column: position.character + 1,
              file: fileName.slice(uiSourceDirectory.length + 1),
              line: position.line + 1,
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
      return fileFindings;
    });

    expect(anchors).toEqual(['breadcrumb.tsx', 'hover-card.tsx', 'navigation-menu.tsx']);
    expect(spreadKinds).toEqual({
      'breadcrumb.tsx': ['style.attrs', 'passThroughProps'],
      'hover-card.tsx': ['style.attrs', 'passThroughProps'],
      'navigation-menu.tsx': ['style.attrs', 'passThroughProps'],
    });
    expect(findings).toEqual([]);
  });

  it.each([
    ['ordinary local execution', undefined],
    ['CI execution', '1'],
  ])('derives the exact copied-anchor reconstruction boundary under %s', (_label, ciValue) => {
    const previousCi = process.env.CI;
    if (ciValue === undefined) delete process.env.CI;
    else process.env.CI = ciValue;

    try {
      for (const name of ['breadcrumb', 'hover-card', 'navigation-menu'] as const) {
        const entry = vendoredUiComponents[name];
        const result = compileComponentModule({
          fileName: `src/components/ui/${entry.fileName}`,
          source: entry.source,
        });
        expect(
          result.diagnostics.filter(
            (diagnostic) =>
              diagnostic.code === 'KV236' && diagnostic.message.includes('opaque <a> spread'),
          ),
          name,
        ).toEqual([]);
        expect(result.files.find((file) => file.kind === 'server')?.source, name).toContain(
          "kovoSafeJsxSpread(passThroughProps(props), 'ui-anchor')",
        );
      }
    } finally {
      if (previousCi === undefined) delete process.env.CI;
      else process.env.CI = previousCi;
    }
  });

  it('emits one collision-free receipt import for a hostile copied link caller with handler, binding, and island controls', () => {
    const result = compileComponentModule({
      fileName: 'src/copied-link-caller.tsx',
      source: `
import { component } from '@kovojs/core';
import { BreadcrumbLink } from '@kovojs/ui/breadcrumb';

const kovoGeneratedComponentControl = 'authored collision';

export const CopiedLinkCaller = component({
  queries: { profile: profileQuery },
  state: () => ({ checked: false }),
  render: ({ profile }, state) => {
    const payload = profile.payload;
    return (
      <BreadcrumbLink
        {...payload}
        aria-label={profile.label}
        data-state={state.checked ? 'open' : 'closed'}
        href="/account"
        onClick={() => {
          state.checked = !state.checked;
        }}
      >{profile.label}</BreadcrumbLink>
    );
  },
});
`,
    });
    const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(errors).toEqual([]);
    expect(() => assertFixpoint(result)).not.toThrow();
    expect(() => assertRenderEquivalence(result)).not.toThrow();
    expect(
      serverSource.match(
        /import \{ kovoGeneratedComponentControl as kovoGeneratedComponentControl_\d+ \} from '@kovojs\/server\/internal\/escape';/gu,
      ),
    ).toHaveLength(1);
    expect(serverSource).toMatch(
      /on:click=\{kovoGeneratedComponentControl_\d+\("on:click", "\/c\/__v\/[0-9a-f]{64}\/src\/copied-link-caller\.client\.js#CopiedLinkCaller\$BreadcrumbLink_click"\)\}/u,
    );
    expect(serverSource).toMatch(
      /data-kovo-module-allowlist=\{kovoGeneratedComponentControl_\d+\("data-kovo-module-allowlist", "\/c\/__v\/[0-9a-f]{64}\/src\/copied-link-caller\.client\.js"\)\}/u,
    );
    expect(serverSource).toMatch(
      /data-derive=\{kovoGeneratedComponentControl_\d+\("data-derive", "profile\.CopiedLinkCaller\$BreadcrumbLink_aria_label_derive"\)\}/u,
    );
    expect(serverSource).toMatch(
      /data-derive-attr=\{kovoGeneratedComponentControl_\d+\("data-derive-attr", "aria-label"\)\}/u,
    );
    expect(serverSource).toMatch(
      /data-bind:data-state=\{kovoGeneratedComponentControl_\d+\("data-bind:data-state", "\/c\/__v\/[0-9a-f]{64}\/src\/copied-link-caller\.client\.js#CopiedLinkCaller\$BreadcrumbLink_data_state_derive"\)\}/u,
    );
    expect(serverSource).toMatch(
      /kovo-state=\{kovoGeneratedComponentControl_\d+\("kovo-state", "[^\n]*checked[^\n]*false[^\n]*"\)\}/u,
    );
    expect(serverSource).toMatch(
      /kovo-deps=\{kovoGeneratedComponentControl_\d+\("kovo-deps", \[__kovoEncodeGeneratedDependencyIdentity\(profileQuery\.key \?\? "profile"\)\]\.join\(' '\)\)\}/u,
    );
    expect(serverSource).toMatch(
      /kovo-plan-owner=\{kovoGeneratedComponentControl_\d+\("kovo-plan-owner", "copied-link-caller\/copied-link-caller"\)\}/u,
    );
    expect(serverSource).toMatch(
      /kovo-fragment-target=\{kovoGeneratedComponentControl_\d+\("kovo-fragment-target", "copied-link-caller"\)\}/u,
    );
    expect(serverSource).toMatch(
      /kovo-live-component=\{kovoGeneratedComponentControl_\d+\("kovo-live-component", "copied-link-caller\/copied-link-caller"\)\}/u,
    );
    expect(serverSource).toContain('{...payload}');
    expect(serverSource).not.toMatch(
      /<(?:BreadcrumbLink)[^>]*\sdata-(?:bind|derive)(?::[^=\s]+)?="/u,
    );
    expect(serverSource).not.toContain('kovoGeneratedComponentControl("ON:CLICK"');
  });

  it('receipts an exact query text binding on the copied component host and keeps its client plan', () => {
    const result = compileComponentModule({
      fileName: 'src/c.tsx',
      source: `import { component } from "@kovojs/core"; import { BreadcrumbLink } from "@kovojs/ui/breadcrumb"; export const C = component({ queries:{ profile: profileQuery }, render:({profile}) => <BreadcrumbLink>{profile.label}</BreadcrumbLink> });`,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(serverSource).toMatch(
      /data-bind=\{kovoGeneratedComponentControl\("data-bind", "profile\.label"\)\}/u,
    );
    expect(result.queryUpdatePlans).toEqual([
      expect.objectContaining({ paths: ['profile.label'], query: 'profile' }),
    ]);
    expect(clientSource).toContain('bindings: true');
    expect(() => assertFixpoint(result)).not.toThrow();
    expect(() => assertRenderEquivalence(result)).not.toThrow();
  });

  it('keeps a trusted state-derived copied-link href live only through its exact receipt pair', () => {
    const result = compileComponentModule({
      fileName: 'src/trusted-copied-link.tsx',
      source: `
import { trustedUrl } from '@kovojs/browser';
import { component } from '@kovojs/core';
import { BreadcrumbLink } from '@kovojs/ui/breadcrumb';

export const TrustedCopiedLink = component({
  state: () => ({ href: '/account' }),
  render: (_queries, state) => (
    <BreadcrumbLink
      href={trustedUrl(state.href, { reason: 'reviewed internal navigation' })}
    >
      Account
    </BreadcrumbLink>
  ),
});
`,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect(result.diagnostics).toEqual([]);
    expect(serverSource).toMatch(
      /data-kovo-trusted-url:href=\{kovoGeneratedComponentControl\("data-kovo-trusted-url:href", true\)\}/u,
    );
    expect(serverSource).toMatch(
      /data-bind:href=\{kovoGeneratedComponentControl\("data-bind:href", "\/c\/__v\/[0-9a-f]{64}\/src\/trusted-copied-link\.client\.js#TrustedCopiedLink\$BreadcrumbLink_href_derive"\)\}/u,
    );
    expect(serverSource).toMatch(
      /href=\{trustedUrl\(state\.href,\s*\{\s*reason: 'reviewed internal navigation'\s*\}\)\}/u,
    );
    expect(clientSource).toContain('TrustedCopiedLink$BreadcrumbLink_href_derive');
    expect(clientSource).toContain('state.href');
    expect(result.outputContextFacts).toContainEqual(
      expect.objectContaining({ context: 'url-attribute', sink: 'href', source: 'client-state' }),
    );
    expect(() => assertFixpoint(result)).not.toThrow();
    expect(() => assertRenderEquivalence(result)).not.toThrow();
  });

  it('keeps an ordinary query-derived copied-link href on the runtime URL sink path', () => {
    const result = compileComponentModule({
      fileName: 'src/query-href-copied-link.tsx',
      source: `
import { component } from '@kovojs/core';
import { BreadcrumbLink } from '@kovojs/ui/breadcrumb';

export const QueryHrefCopiedLink = component({
  queries: { profile: profileQuery },
  render: ({ profile }) => <BreadcrumbLink href={profile.href}>Account</BreadcrumbLink>,
});
`,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect(result.diagnostics).toEqual([]);
    expect(serverSource).toMatch(
      /data-derive=\{kovoGeneratedComponentControl\("data-derive", "profile\.QueryHrefCopiedLink\$BreadcrumbLink_href_derive"\)\}/u,
    );
    expect(serverSource).toContain(
      'data-derive-attr={kovoGeneratedComponentControl("data-derive-attr", "href")}',
    );
    expect(serverSource).toContain('href={profile.href}');
    expect(serverSource).not.toContain('data-kovo-trusted-url:href');
    expect(result.queryUpdatePlans).toEqual([
      expect.objectContaining({
        query: 'profile',
        stamps: [
          expect.objectContaining({
            attr: 'href',
            derive: expect.objectContaining({ expression: 'profile.href' }),
          }),
        ],
      }),
    ]);
    expect(clientSource).toContain('QueryHrefCopiedLink$BreadcrumbLink_href_derive');
    expect(() => assertFixpoint(result)).not.toThrow();
    expect(() => assertRenderEquivalence(result)).not.toThrow();
  });

  it('keeps an ordinary state-derived copied-link href on the runtime URL sink path', () => {
    const result = compileComponentModule({
      fileName: 'src/state-href-copied-link.tsx',
      source: `
import { component } from '@kovojs/core';
import { BreadcrumbLink } from '@kovojs/ui/breadcrumb';

export const StateHrefCopiedLink = component({
  state: () => ({ href: '/account' }),
  render: (_queries, state) => <BreadcrumbLink href={state.href}>Account</BreadcrumbLink>,
});
`,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect(result.diagnostics).toEqual([]);
    expect(serverSource).toMatch(
      /data-bind:href=\{kovoGeneratedComponentControl\("data-bind:href", "\/c\/__v\/[0-9a-f]{64}\/src\/state-href-copied-link\.client\.js#StateHrefCopiedLink\$BreadcrumbLink_href_derive"\)\}/u,
    );
    expect(serverSource).toContain('href={state.href}');
    expect(serverSource).not.toContain('data-kovo-trusted-url:href');
    expect(clientSource).toContain('StateHrefCopiedLink$BreadcrumbLink_href_derive');
    expect(clientSource).toContain('state.href');
    expect(() => assertFixpoint(result)).not.toThrow();
    expect(() => assertRenderEquivalence(result)).not.toThrow();
  });

  it('receipts a canonical camelCase tabIndex binding across a copied link', () => {
    const result = compileComponentModule({
      fileName: 'src/tab-index-copied-link.tsx',
      source: `
import { component } from '@kovojs/core';
import { BreadcrumbLink } from '@kovojs/ui/breadcrumb';

export const TabIndexCopiedLink = component({
  state: () => ({ index: 0 }),
  render: (_queries, state) => (
    <BreadcrumbLink href="/account" tabIndex={state.index}>Account</BreadcrumbLink>
  ),
});
`,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect(result.diagnostics).toEqual([]);
    expect(serverSource).toMatch(
      /data-bind:tabIndex=\{kovoGeneratedComponentControl\("data-bind:tabIndex", "\/c\/__v\/[0-9a-f]{64}\/src\/tab-index-copied-link\.client\.js#TabIndexCopiedLink\$BreadcrumbLink_tabIndex_derive"\)\}/u,
    );
    expect(clientSource).toContain('TabIndexCopiedLink$BreadcrumbLink_tabIndex_derive');
    expect(clientSource).toContain('state.index');
    expect(() => assertFixpoint(result)).not.toThrow();
    expect(() => assertRenderEquivalence(result)).not.toThrow();
  });

  it('receipts canonical scrollTop attribute and property bindings across a generic component host', () => {
    const result = compileComponentModule({
      fileName: 'src/scroll-host.tsx',
      source: `
import { component } from '@kovojs/core';
import { Viewport } from './viewport.js';

export const ScrollHost = component({
  state: () => ({ top: 0 }),
  render: (_queries, state) => <Viewport scrollTop={state.top} />,
});
`,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(result.diagnostics).toEqual([]);
    expect(serverSource).toMatch(
      /data-bind:scrollTop=\{kovoGeneratedComponentControl\("data-bind:scrollTop", "\/c\/__v\/[0-9a-f]{64}\/src\/scroll-host\.client\.js#ScrollHost\$Viewport_scrollTop_derive"\)\}/u,
    );
    expect(serverSource).toMatch(
      /data-bind-prop:scrollTop=\{kovoGeneratedComponentControl\("data-bind-prop:scrollTop", "\/c\/__v\/[0-9a-f]{64}\/src\/scroll-host\.client\.js#ScrollHost\$Viewport_scrollTop_derive"\)\}/u,
    );
    expect(() => assertFixpoint(result)).not.toThrow();
    expect(() => assertRenderEquivalence(result)).not.toThrow();
  });

  it('receipts the finite primitive-composition controls before they cross a copied link', () => {
    const result = compileComponentModule({
      fileName: 'src/composed-copied-link.tsx',
      source: `
import { component } from '@kovojs/core';
import { BreadcrumbLink } from '@kovojs/ui/breadcrumb';

export const ComposedCopiedLink = component({
  render: () => (
    <Tooltip.Trigger
      asChild
      attrs={{
        'aria-describedby': 'account-tip',
        'data-state': 'open',
        'kovo-context-menu': 'account-menu',
        'kovo-hover-card': 'account-card',
        'kovo-tooltip': 'account-tip',
      }}
    >
      <BreadcrumbLink href="/account">Account</BreadcrumbLink>
    </Tooltip.Trigger>
  ),
});
`,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(result.diagnostics).toEqual([]);
    for (const [name, value] of [
      ['data-state', 'open'],
      ['kovo-context-menu', 'account-menu'],
      ['kovo-hover-card', 'account-card'],
      ['kovo-tooltip', 'account-tip'],
    ] as const) {
      expect(serverSource).toContain(
        `${name}={kovoGeneratedComponentControl(${JSON.stringify(name)}, ${JSON.stringify(value)})}`,
      );
    }
    expect(serverSource).toContain('aria-describedby="account-tip"');
    expect(() => assertFixpoint(result)).not.toThrow();
    expect(() => assertRenderEquivalence(result)).not.toThrow();
  });

  it('preserves edited helper dependency semantics behind the UI-anchor runtime boundary', () => {
    const entry = vendoredUiComponents.breadcrumb;
    const source = entry.source.replace(
      "const islandOwnershipProps = new Set(['kovo-c', 'kovo-state', 'kovo-deps']);",
      "const islandOwnershipProps = new Set(['kovo-c', 'kovo-state', 'kovo-deps']);\nblockedProps.clear();\nislandOwnershipProps.clear();",
    );
    expect(source).not.toBe(entry.source);

    const result = compileComponentModule({
      fileName: `src/components/ui/${entry.fileName}`,
      source,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(
      result.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === 'KV236' && diagnostic.message.includes('opaque <a> spread'),
      ),
    ).toEqual([]);
    expect(serverSource).toContain('blockedProps.clear();');
    expect(serverSource).toContain('islandOwnershipProps.clear();');
    expect(serverSource).toContain("kovoSafeJsxSpread(passThroughProps(props), 'ui-anchor')");
    expect(() => assertFixpoint(result)).not.toThrow();
    expect(() => assertRenderEquivalence(result)).not.toThrow();
  });

  it.each([
    [
      'nested props binding',
      `
export const NestedProps = component({
  render(props: object) {
    const nested = (props: object) => <a {...passThroughProps(props)}>Account</a>;
    return nested(props);
  },
});
`,
    ],
    [
      'reassigned render props',
      `
export const ReassignedProps = component({
  render(props: object) {
    props = { 'aria-label': 'reassigned' };
    return <a {...passThroughProps(props)}>Account</a>;
  },
});
`,
    ],
    [
      'same-named nested helper',
      `
export const ShadowedHelper = component({
  render(props: object) {
    const passThroughProps = (value: object) => value;
    return <a {...passThroughProps(props)}>Account</a>;
  },
});
`,
    ],
  ])('closes the copy-in boundary after %s drift', (_label, probe) => {
    const source = `${copiedUiHelperPrelude(vendoredUiComponents.breadcrumb.source)}\n${probe}`;
    const result = compileComponentModule({
      fileName: 'src/components/ui/drifted-breadcrumb.tsx',
      source,
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV236',
        message: expect.stringContaining('opaque <a> spread'),
      }),
    );
    expect(result.files.find((file) => file.kind === 'server')?.source ?? '').not.toContain(
      "kovoSafeJsxSpread(passThroughProps(props), 'ui-anchor')",
    );
  });

  it.each([
    [
      'exact compiler ABI name',
      "import { kovoGeneratedComponentControl } from '@kovojs/server/internal/escape';",
      'kovoGeneratedComponentControl',
    ],
    [
      'aliased compiler ABI name',
      "import { kovoGeneratedComponentControl as mintControl } from '@kovojs/server/internal/escape';",
      'mintControl',
    ],
  ])('keeps an app-authored %s import behind KV235', (_label, imported, helper) => {
    const result = compileComponentModule({
      fileName: 'src/authored-control-receipt.tsx',
      source: `
import { component } from '@kovojs/core';
${imported}
export const AuthoredReceipt = component({
  render: () => <Probe on:click={${helper}('on:click', '/c/authored.client.js#run')} />,
});
`,
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV235',
        message: expect.stringContaining('non-public Kovo subpath'),
      }),
    );
  });

  it.each([
    [
      'mismatched literal name',
      '',
      "kovoGeneratedComponentControl('on:pointerenter', '/c/authored.client.js#run')",
      'on:click',
    ],
    [
      'dynamic executable value',
      "const runtimeRef = '/c/authored.client.js#run';",
      "kovoGeneratedComponentControl('on:click', runtimeRef)",
      'on:click',
    ],
    [
      'unsupported executable control',
      '',
      "kovoGeneratedComponentControl('data-stream-renderer', '/c/authored.client.js#run')",
      'data-stream-renderer',
    ],
    [
      'local helper alias',
      'const mintControl = kovoGeneratedComponentControl;',
      "mintControl('on:click', '/c/authored.client.js#run')",
      'on:click',
    ],
    [
      'nested same-named helper',
      '',
      "((kovoGeneratedComponentControl) => kovoGeneratedComponentControl('on:click', '/c/authored.client.js#run'))((name: string, value: string) => value)",
      'on:click',
    ],
  ])('does not grant a generated-receipt parser fact to a %s', (_label, setup, call, name) => {
    const result = compileComponentModule({
      fileName: 'src/forged-control-receipt.tsx',
      source: `
import { component } from '@kovojs/core';
import { kovoGeneratedComponentControl } from '@kovojs/server/internal/escape';
${setup}
export const ForgedReceipt = component({
  render: () => <Probe ${name}={${call}} />,
});
`,
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV449',
        message: expect.stringContaining('runtime-selected'),
      }),
    );
  });

  it.each([
    ['missing marker', (source: string) => source.replace('// @kovojs-ui-copy\n', '')],
    [
      'mutated marker',
      (source: string) => source.replace('// @kovojs-ui-copy', '// @kovojs-ui-copy-mutated'),
    ],
    ['renamed helper', (source: string) => source.replaceAll('passThroughProps', 'projectProps')],
    [
      'wrapped call',
      (source: string) =>
        source.replace('{...passThroughProps(props)}', '{...identity(passThroughProps(props))}'),
    ],
    [
      'modified helper body',
      (source: string) =>
        source.replace(
          'const includeEvents = options.events ?? true;',
          'const includeEvents = options.events ?? false;',
        ),
    ],
    [
      'non-props argument',
      (source: string) =>
        source.replace('{...passThroughProps(props)}', '{...passThroughProps({})}'),
    ],
    [
      'non-default options',
      (source: string) =>
        source.replace(
          '{...passThroughProps(props)}',
          '{...passThroughProps(props, { events: true })}',
        ),
    ],
  ])('does not treat a %s as the reviewed copy-in boundary', (_label, mutate) => {
    const entry = vendoredUiComponents.breadcrumb;
    const source = mutate(entry.source);
    expect(source).not.toBe(entry.source);
    const result = compileComponentModule({
      fileName: `src/components/ui/${entry.fileName}`,
      source,
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV236',
        message: expect.stringContaining('opaque <a> spread'),
      }),
    );
    expect(result.files.find((file) => file.kind === 'server')?.source ?? '').not.toContain(
      "kovoSafeJsxSpread(passThroughProps(props), 'ui-anchor')",
    );
  });

  it('keeps an ordinary authored opaque anchor closed', () => {
    const result = compileComponentModule({
      fileName: 'src/ordinary-anchor.tsx',
      source: `
import { component } from '@kovojs/core';
export const OrdinaryAnchor = component({
  render(props) {
    return <a {...props} href="/account">Account</a>;
  },
});
`,
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV236',
        message: expect.stringContaining('opaque <a> spread'),
      }),
    );
  });
});
