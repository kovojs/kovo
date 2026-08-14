// @kovo-security-classifier-corpus kv235-source-provenance
import type * as TS from 'typescript';
import { describe, expect, it } from 'vitest';

import { typescriptRuntime as ts } from '../ts-api.js';
import {
  identifierIsShadowedBeforeScope,
  lexicalScopeDeclarationIndexIdentityForTesting,
  parseSourceFile,
} from './parse.js';

function identifiersNamed(sourceFile: TS.SourceFile, name: string): TS.Identifier[] {
  const matches: TS.Identifier[] = [];
  const visit = (node: TS.Node): void => {
    if (ts.isIdentifier(node) && node.text === name) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return matches;
}

function finalIdentifierNamed(sourceFile: TS.SourceFile, name: string): TS.Identifier {
  const matches = identifiersNamed(sourceFile, name);
  const match = matches[matches.length - 1];
  if (match === undefined) throw new Error(`Missing test identifier ${name}.`);
  return match;
}

function nearestArrowFunction(node: TS.Node): TS.ArrowFunction {
  let current: TS.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isArrowFunction(current)) return current;
    current = current.parent;
  }
  throw new Error('Missing test arrow-function scope.');
}

function nearestBlock(node: TS.Node): TS.Block {
  let current: TS.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isBlock(current)) return current;
    current = current.parent;
  }
  throw new Error('Missing test block scope.');
}

function isShadowedThroughSource(
  sourceFile: TS.SourceFile,
  name: string,
  excluded?: TS.Identifier,
): boolean {
  // A distinct node keeps the walk going through SourceFile, exercising module and nested scopes.
  const foreignBoundary = parseSourceFile('foreign-boundary.ts', '');
  return identifierIsShadowedBeforeScope(
    finalIdentifierNamed(sourceFile, name),
    excluded,
    foreignBoundary,
  );
}

describe('exact lexical-scope declaration index', () => {
  it('preserves lexical boundaries, var hoisting, and direct function/class declarations', () => {
    const sourceFile = parseSourceFile(
      'scope-boundaries.tsx',
      `
function render() {
  { let NestedLet = 1; const NestedConst = 2; }
  { var NestedVar = 3; }
  { function NestedFunction() {} class NestedClass {} }
  function DirectFunction() {}
  class DirectClass {}
  consume(NestedLet, NestedConst, NestedVar, NestedFunction, NestedClass);
  consume(DirectFunction, DirectClass);
}
`,
    );

    expect(isShadowedThroughSource(sourceFile, 'NestedLet')).toBe(false);
    expect(isShadowedThroughSource(sourceFile, 'NestedConst')).toBe(false);
    expect(isShadowedThroughSource(sourceFile, 'NestedVar')).toBe(true);
    expect(isShadowedThroughSource(sourceFile, 'NestedFunction')).toBe(false);
    expect(isShadowedThroughSource(sourceFile, 'NestedClass')).toBe(false);
    expect(isShadowedThroughSource(sourceFile, 'DirectFunction')).toBe(true);
    expect(isShadowedThroughSource(sourceFile, 'DirectClass')).toBe(true);
  });

  it('indexes parameters, destructuring, catch bindings, imports, and type-only imports exactly', () => {
    const sourceFile = parseSourceFile(
      'binding-kinds.tsx',
      `
import DefaultBinding, { NamedBinding, type TypeBinding } from './named.js';
import * as NamespaceBinding from './namespace.js';
function render({ ParameterBinding, nested: { DeepParameterBinding } }) {
  const [ArrayBinding, { value: ObjectBinding }, ...RestBinding] = input;
  try { work(); } catch ({ message: CatchBinding }) { consume(CatchBinding); }
  consume(ParameterBinding, DeepParameterBinding, ArrayBinding, ObjectBinding, RestBinding);
  consume(DefaultBinding, NamedBinding, TypeBinding, NamespaceBinding);
}
`,
    );

    for (const name of [
      'ParameterBinding',
      'DeepParameterBinding',
      'ArrayBinding',
      'ObjectBinding',
      'RestBinding',
      'CatchBinding',
      'DefaultBinding',
      'NamedBinding',
      'TypeBinding',
      'NamespaceBinding',
    ]) {
      expect(isShadowedThroughSource(sourceFile, name), name).toBe(true);
    }
  });

  it('preserves exact excluded-binding identity, including duplicate declarations', () => {
    const sole = parseSourceFile(
      'sole-binding.tsx',
      `import { reviewed } from './reviewed.js'; consume(reviewed);`,
    );
    const [soleBinding] = identifiersNamed(sole, 'reviewed');
    expect(soleBinding).toBeDefined();
    expect(isShadowedThroughSource(sole, 'reviewed', soleBinding)).toBe(false);

    const duplicate = parseSourceFile(
      'duplicate-binding.tsx',
      `import { reviewed } from './reviewed.js'; const reviewed = local; consume(reviewed);`,
    );
    const [importBinding] = identifiersNamed(duplicate, 'reviewed');
    expect(importBinding).toBeDefined();
    expect(isShadowedThroughSource(duplicate, 'reviewed', importBinding)).toBe(true);
  });

  it('constructs one index per exact scope instead of walking it once per JSX identifier', () => {
    const tags = Array.from({ length: 216 }, (_, index) => `<C${String(index)} />`).join('\n');
    const sourceFile = parseSourceFile(
      'dense-render.tsx',
      `const render = () => (<section>${tags}</section>);`,
    );
    const references = Array.from({ length: 216 }, (_, index) =>
      finalIdentifierNamed(sourceFile, `C${String(index)}`),
    );
    const foreignBoundary = parseSourceFile('dense-foreign-boundary.ts', '');
    const renderScope = nearestArrowFunction(references[0]!);

    expect(identifierIsShadowedBeforeScope(references[0]!, undefined, foreignBoundary)).toBe(false);
    const renderIndex = lexicalScopeDeclarationIndexIdentityForTesting(renderScope);
    const sourceIndex = lexicalScopeDeclarationIndexIdentityForTesting(sourceFile);
    for (let index = 1; index < references.length; index += 1) {
      const reference = references[index]!;
      expect(identifierIsShadowedBeforeScope(reference, undefined, foreignBoundary)).toBe(false);
    }

    // All 216 lookups reuse the exact two scope indexes. A byte-identical fresh AST cannot alias
    // either identity, proving this is object-scoped reuse rather than a content cache.
    expect(lexicalScopeDeclarationIndexIdentityForTesting(renderScope)).toBe(renderIndex);
    expect(lexicalScopeDeclarationIndexIdentityForTesting(sourceFile)).toBe(sourceIndex);
    const fresh = parseSourceFile(
      'dense-render.tsx',
      `const render = () => (<section>${tags}</section>);`,
    );
    expect(
      lexicalScopeDeclarationIndexIdentityForTesting(
        nearestArrowFunction(finalIdentifierNamed(fresh, 'C0')),
      ),
    ).not.toBe(renderIndex);
  });

  it('keys reuse by exact AST identity and cannot be redirected by poisoned collection methods', () => {
    const first = parseSourceFile(
      'same.tsx',
      `function render() { const Local = 1; consume(Local); }`,
    );
    const second = parseSourceFile(
      'same.tsx',
      `function render() { const Local = 1; consume(Local); }`,
    );
    const foreignBoundary = parseSourceFile('identity-foreign-boundary.ts', '');
    const firstReference = finalIdentifierNamed(first, 'Local');
    const secondReference = finalIdentifierNamed(second, 'Local');

    expect(identifierIsShadowedBeforeScope(firstReference, undefined, foreignBoundary)).toBe(true);
    expect(identifierIsShadowedBeforeScope(secondReference, undefined, foreignBoundary)).toBe(true);
    expect(lexicalScopeDeclarationIndexIdentityForTesting(nearestBlock(firstReference))).not.toBe(
      lexicalScopeDeclarationIndexIdentityForTesting(nearestBlock(secondReference)),
    );

    // Source parsing is a TypeScript boundary; construct the exact AST before poisoning realm
    // collection methods so this test isolates the compiler-owned index construction and lookup.
    const fresh = parseSourceFile(
      'poisoned.tsx',
      `function render() { const Local = 1; consume(Local); }`,
    );
    const freshReference = finalIdentifierNamed(fresh, 'Local');

    const nativeMapGet = Map.prototype.get;
    const nativeMapSet = Map.prototype.set;
    const nativeWeakMapGet = WeakMap.prototype.get;
    const nativeWeakMapSet = WeakMap.prototype.set;
    let poisonHits = 0;
    let freshResult: boolean | undefined;
    let cachedResult: boolean | undefined;
    try {
      Map.prototype.get = function poisonedMapGet() {
        poisonHits += 1;
        return undefined;
      };
      Map.prototype.set = function poisonedMapSet() {
        poisonHits += 1;
        return this;
      };
      WeakMap.prototype.get = function poisonedWeakMapGet() {
        poisonHits += 1;
        return undefined;
      };
      WeakMap.prototype.set = function poisonedWeakMapSet() {
        poisonHits += 1;
        return this;
      };

      // A fresh AST forces construction, while the already-indexed AST proves the cached path.
      freshResult = identifierIsShadowedBeforeScope(freshReference, undefined, foreignBoundary);
      cachedResult = identifierIsShadowedBeforeScope(firstReference, undefined, foreignBoundary);
    } finally {
      Map.prototype.get = nativeMapGet;
      Map.prototype.set = nativeMapSet;
      WeakMap.prototype.get = nativeWeakMapGet;
      WeakMap.prototype.set = nativeWeakMapSet;
    }
    expect(freshResult).toBe(true);
    expect(cachedResult).toBe(true);
    expect(poisonHits).toBe(0);
  });
});
