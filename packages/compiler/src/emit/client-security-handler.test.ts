import { runInNewContext } from 'node:vm';

import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import { rewriteClientModuleRuntimeImportsForBrowser } from './client.js';

const generatedAbiImport = "import { securityHandler } from '@kovojs/browser/generated';\n\n";

function emittedSecurityHandlerSource(manifest: string, prelude = ''): string {
  return rewriteClientModuleRuntimeImportsForBrowser(`${generatedAbiImport}${prelude}
export const probe = securityHandler(${manifest}, () => 'accepted');
`);
}

function executeEmittedModule(
  source: string,
  globals: Record<string, unknown> = {},
): Record<string, unknown> {
  const exports: Record<string, unknown> = {};
  const executable = source.replace(/export const ([A-Za-z_$][\w$]*)/g, 'const $1 = exports.$1');
  runInNewContext(executable, { ...globals, exports }, { timeout: 1_000 });
  return exports;
}

function findVariable(sourceFile: ts.SourceFile, name: string): ts.VariableDeclaration | undefined {
  let found: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

describe('SPEC §5.2 generated client security-operation helper', () => {
  it('emits parseable standalone helper IR and accepts the exact reviewed browser tuple', () => {
    const source = emittedSecurityHandlerSource(
      `[{ door: 'compiler-state', kind: 'browser.state.write', target: 'state.count' }]`,
    );
    const sourceFile = ts.createSourceFile(
      'counter.client.js',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const declaration = findVariable(sourceFile, 'securityHandler');

    expect(sourceFile.parseDiagnostics).toEqual([]);
    expect(declaration?.initializer && ts.isArrowFunction(declaration.initializer)).toBe(true);
    expect(source).not.toContain('@kovojs/browser/generated');
    expect((executeEmittedModule(source).probe as () => string)()).toBe('accepted');
  });

  it.each([
    ['empty operation', '[{}]', ''],
    ['missing door', "[{ kind: 'browser.state.write', target: 'state.count' }]", ''],
    ['missing kind', "[{ door: 'compiler-state', target: 'state.count' }]", ''],
    [
      'inherited required fields',
      '[operation]',
      "const operation = Object.create({ door: 'compiler-state', kind: 'browser.state.write' });",
    ],
    [
      'inherited optional target',
      '[operation]',
      `const operation = Object.create({ target: 'state.count' });
Object.defineProperties(operation, {
  door: { enumerable: true, value: 'compiler-state' },
  kind: { enumerable: true, value: 'browser.state.write' },
});`,
    ],
    [
      'present undefined target',
      "[{ door: 'compiler-state', kind: 'browser.state.write', target: undefined }]",
      '',
    ],
    [
      'non-enumerable extra field',
      '[operation]',
      `const operation = { door: 'compiler-state', kind: 'browser.state.write' };
Object.defineProperty(operation, 'hiddenAuthority', { value: true });`,
    ],
    [
      'symbol extra field',
      '[operation]',
      `const operation = { door: 'compiler-state', kind: 'browser.state.write' };
operation[Symbol('hiddenAuthority')] = true;`,
    ],
    ['prototype-name kind', "[{ door: Object.prototype, kind: '__proto__' }]", ''],
    ['sparse manifest', 'new Array(1)', ''],
  ])('fails closed for a %s', (_label, manifest, prelude) => {
    expect(() => executeEmittedModule(emittedSecurityHandlerSource(manifest, prelude))).toThrow(
      'KV449: invalid generated browser security operation.',
    );
  });

  it.each(['kind', 'door', 'target'])('rejects an own %s accessor without invoking it', (field) => {
    const accessed = vi.fn();
    const source = emittedSecurityHandlerSource(
      '[operation]',
      `const operation = { door: 'compiler-state', kind: 'browser.state.write' };
Object.defineProperty(operation, '${field}', {
  enumerable: true,
  get() { accessed(); return ${
    field === 'kind'
      ? "'browser.state.write'"
      : field === 'door'
        ? "'compiler-state'"
        : "'state.count'"
  }; },
});`,
    );

    expect(() => executeEmittedModule(source, { accessed })).toThrow(
      'KV449: invalid generated browser security operation.',
    );
    expect(accessed).not.toHaveBeenCalled();
  });

  it('rejects an accessor array entry without invoking it', () => {
    const accessed = vi.fn();
    const source = emittedSecurityHandlerSource(
      'manifest',
      `const manifest = [];
Object.defineProperty(manifest, '0', {
  enumerable: true,
  get() { accessed(); return { door: 'compiler-state', kind: 'browser.state.write' }; },
});`,
    );

    expect(() => executeEmittedModule(source, { accessed })).toThrow(
      'KV449: invalid generated browser security operation.',
    );
    expect(accessed).not.toHaveBeenCalled();
  });
});
