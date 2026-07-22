import { describe, expect, it } from 'vitest';
import ts from 'typescript';

import { compileComponentModule } from './index.js';

function compile(handlerBody: string) {
  return compileComponentModule({
    fileName: 'typed-handler.tsx',
    source: `
export const TypedHandler = component({
  state: () => ({ count: 0 }),
  render: () => (
    <button onClick={() => { ${handlerBody} }}>Run</button>
  ),
});
`,
  });
}

function compileItemHandler(handlerBody: string) {
  return compileComponentModule({
    fileName: 'typed-item-handler.tsx',
    source: `
export const TypedItemHandler = component({
  state: () => ({ count: 0 }),
  render: ({ item }) => (
    <button onClick={() => { ${handlerBody} }}>Run</button>
  ),
});
`,
  });
}

function clientSource(result: ReturnType<typeof compileComponentModule>): string {
  return result.files.find((file) => file.kind === 'client')?.source ?? '';
}

describe('inline handler TypeScript erasure', () => {
  it('emits valid JavaScript from nested erasable TypeScript syntax', () => {
    // A successful compile proves more than a string snapshot: the mandatory emitted-translation
    // gate independently reparses this generated client module as JavaScript (SPEC §5.2).
    const result = compile(`
      type Count = number;
      interface IterableShape { [Symbol.iterator](): Iterator<number>; }
      abstract class IterableBase { abstract [Symbol.iterator](): Iterator<number>; }
      const current!: unknown = state.count;
      const next: number = (((current! as unknown) as number) satisfies number);
      const identity = < /*a*/ T /*b*/ ,>(value?: T): T | undefined => value;
      function onlyThis(this: Count,) { return 1; }
      state.count = identity< /*c*/ number /*d*/ >(next)! + onlyThis();
      state.count = (state.count! as number) satisfies number;
    `);
    const source = clientSource(result);

    expect(source).toContain('const current = ctx.state.count;');
    expect(source).toContain('const next = (((current)));');
    expect(source).toContain('const identity = (value) => value;');
    expect(source).toContain('function onlyThis()');
    expect(source).toContain('ctx.state.count = identity(next) + onlyThis();');
    expect(source).toContain('ctx.state.count = (ctx.state.count);');
    expect(source).not.toContain('type Count');
    expect(source).not.toContain('interface IterableShape');
    expect(source).not.toContain('abstract [Symbol.iterator]');
    expect(source).not.toContain(' as unknown');
    expect(source).not.toContain(' satisfies number');
    expect(source).not.toContain('<T,>');
    expect(source).not.toContain('<number>');
    expect(source).not.toContain('/*a*/');
    expect(source).not.toContain('/*b*/');
    expect(source).not.toContain('/*c*/');
    expect(source).not.toContain('/*d*/');
  });

  it('erases nested class types, modifiers, implements clauses, and this parameters', () => {
    const result = compile(`
      class Box<T> implements Disposable<T> {
        readonly value?: T;
        public read(this: Box<T>, fallback?: T): T | undefined {
          return this.value ?? fallback;
        }
      }
      const box: Box<number> = new Box<number>();
      state.count = box.read(undefined)! ?? 0;
    `);
    const source = clientSource(result);

    expect(source).toContain('read(fallback)');
    expect(source).toContain('new Box()');
    expect(source).not.toContain('implements Disposable');
    expect(source).not.toContain('readonly value');
    expect(source).not.toContain('public read');
    expect(source).not.toContain('this: Box');
    expect(source).not.toContain('Box<number>');
  });

  it('preserves a statement boundary when a type-only declaration is erased', () => {
    const result = compile(`
      function foo() { return () => undefined; }
      function bar() { return undefined; }
      foo()
      type Removed = number
      (bar)()
    `);
    const source = clientSource(result);
    const sourceFile = ts.createSourceFile(
      'typed-handler.client.js',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    let handlerBlock: ts.Block | undefined;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'securityHandler' &&
        node.arguments[1] &&
        ts.isArrowFunction(node.arguments[1]) &&
        ts.isBlock(node.arguments[1].body)
      ) {
        handlerBlock = node.arguments[1].body;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    expect(handlerBlock).toBeDefined();
    const statements = handlerBlock?.statements ?? [];
    const fooIndex = statements.findIndex(
      (statement) =>
        ts.isExpressionStatement(statement) &&
        ts.isCallExpression(statement.expression) &&
        ts.isIdentifier(statement.expression.expression) &&
        statement.expression.expression.text === 'foo',
    );
    const barIndex = statements.findIndex(
      (statement) =>
        ts.isExpressionStatement(statement) &&
        ts.isCallExpression(statement.expression) &&
        ts.isParenthesizedExpression(statement.expression.expression) &&
        ts.isIdentifier(statement.expression.expression.expression) &&
        statement.expression.expression.expression.text === 'bar',
    );

    expect(fooIndex).toBeGreaterThanOrEqual(0);
    expect(barIndex).toBe(fooIndex + 1);
    expect(statements[fooIndex]?.getText(sourceFile).endsWith(';')).toBe(true);
    expect(source).not.toContain('type Removed');
  });

  it.each([
    ['accessor-field', 'class Box { accessor value = 1; }'],
    ['ambient-declaration', 'declare const ambientValue: number;'],
    ['decorator', 'class Box { @dec value = 1; }'],
    ['enum-declaration', 'enum Mode { Ready }'],
    ['function-signature', 'function read(value: number): number;'],
    ['namespace-declaration', 'namespace Local { export const value = 1; }'],
    ['import-equals-declaration', `import helper = require('helper');`],
    ['module-syntax', `import { helper } from 'helper';`],
    ['parameter-property', 'class Box { constructor(public value: number) {} }'],
    ['uninitialized-const', 'const value: number;'],
    ['using-declaration', 'using item = resource;'],
    ['jsx-expression', 'const child = <span />;'],
  ])('fails before emission for runtime-bearing %s syntax', (kind, handlerBody) => {
    expect(() => compile(handlerBody)).toThrow(
      `Unsupported TypeScript client-handler syntax (${kind})`,
    );
  });

  it.each([
    [
      'nested parameter',
      'function read(external: number) { return external; } state.count = external;',
    ],
    [
      'sibling block binding',
      '{ const external = 1; state.count = external; } state.count = external;',
    ],
    [
      'body var hidden from a default parameter',
      'function read(value = external) { var external = 1; return value; } state.count = read();',
    ],
    [
      'object binding default hidden from a body var',
      'function read({ value = external }) { var external = 1; return value; } state.count = read({});',
    ],
    [
      'array binding default hidden from a body var',
      'function read([value = external]) { var external = 1; return value; } state.count = read([]);',
    ],
    [
      'nested binding default hidden from a body var',
      'function read({ value: { nested = external } }) { var external = 1; return nested; } state.count = read({ value: {} });',
    ],
    [
      'computed binding key hidden from a body var',
      'function read({ [external]: value }) { var external = 1; return value; } state.count = read({});',
    ],
    [
      'catch binding',
      'try { throw 1; } catch (external) { void external; } state.count = external;',
    ],
    ['for binding', 'for (let external = 0; external < 1; external++) {} state.count = external;'],
    [
      'switch binding',
      'switch (state.count) { case 0: let external = 1; void external; } state.count = external;',
    ],
    [
      'class static-block binding',
      'class Local { static { var external = 1; void external; } } state.count = external;',
    ],
    ['property names', 'const local = { external: 1 }; state.count = external + local.external;'],
  ])('keeps a free import visible beside a %s of the same name', (_label, handlerBody) => {
    const result = compileComponentModule({
      fileName: 'scoped-handler-capture.tsx',
      source: `
import { external } from './external.js';
export const ScopedHandler = component({
  state: () => ({ count: 0 }),
  render: () => <button onClick={() => { ${handlerBody} }}>Run</button>,
});
`,
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV437');
    expect(result.handlerExports).toEqual([]);
    expect(clientSource(result)).not.toContain("from './external.js'");
  });

  it.each(['var', 'let'])('does not extend a static-block %s binding past the class', (kind) => {
    const result = compile(`
      class Local { static { ${kind} external = 1; void external; } }
      state.count = external;
    `);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV201');
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV201')).toHaveLength(1);
  });

  it.each([
    ['plain', 'class Derived extends external {}'],
    ['generic', 'class Derived extends external<number> {}'],
    ['qualified generic', 'class Derived extends external.Base<number> {}'],
    ['parenthesized qualified', 'class Derived extends (external.Base) {}'],
    ['computed qualified', "class Derived extends external['Base'] {}"],
  ])('keeps %s class heritage runtime-visible and non-serializable', (_label, handlerBody) => {
    const result = compile(handlerBody);
    const source = clientSource(result);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV201');
    expect(source).not.toContain('ctx.params.base');
    expect(result.files.map((file) => file.source).join('\n')).not.toContain('data-p-base');
  });

  it('erases implements heritage without treating its names as runtime captures', () => {
    const result = compile(`
      class Base {}
      class Derived extends Base implements external.Base<number> {}
      void Derived;
    `);
    const source = clientSource(result);
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).not.toContain('KV201');
    expect(codes).not.toContain('KV437');
    expect(source).toContain('class Derived extends Base');
    expect(source).not.toContain('implements external');
  });

  it('withholds an imported constructor used by runtime class heritage', () => {
    const result = compileComponentModule({
      fileName: 'heritage-capture.tsx',
      source: `
import { external } from './external.js';
export const HeritageCapture = component({
  render: () => <button onClick={() => { class Derived extends external.Base<number> {} }}>Run</button>,
});
`,
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV437');
    expect(result.handlerExports).toEqual([]);
    expect(clientSource(result)).not.toContain("from './external.js'");
  });

  it.each([
    ['bare', 'const callable = external<number>; void callable;'],
    ['parenthesized', 'const callable = (external)<number>; void callable;'],
    ['qualified', 'const callable = external.Base<number>; void callable;'],
  ])('keeps %s instantiation expressions runtime-visible', (_label, handlerBody) => {
    const result = compile(handlerBody);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV201');
    expect(clientSource(result)).not.toContain('ctx.params.base');
  });

  it.each([
    ['instanceof member', 'const value = {}; void (value instanceof external.Base);'],
    ['template tag', 'external.tag`value`;'],
    ['parenthesized template tag', '(external.tag)`value`;'],
    ['callable alias', 'const callable = external.fn; callable();'],
    ['dynamic constructor', 'new external[key]();'],
    ['dynamic instanceof', 'const value = {}; void (value instanceof external[key]);'],
    ['dynamic call', 'external[key]();'],
  ])('fails %s closed without scalar parameter rewriting', (_label, handlerBody) => {
    const result = compile(handlerBody);
    const source = clientSource(result);
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toContain('KV201');
    expect(codes).toContain('KV449');
    expect(source).not.toContain('ctx.params.base');
    expect(source).not.toContain('ctx.params.fn');
    expect(source).not.toContain('ctx.params.external');
  });

  it.each([
    ['local helper parameter', 'function invoke(f) { f(); } invoke(item.fn);'],
    ['direct callee', 'item.fn();'],
    ['constructor callee', 'new item.Ctor();'],
    ['template tag', 'item.tag`value`;'],
    ['instanceof target', 'void ({} instanceof item.Ctor);'],
    ['object container', 'const box = { f: item.fn }; box.f();'],
    ['array container', 'const box = [item.fn]; box[0]();'],
    ['destructuring container', 'const { f } = { f: item.fn }; f();'],
    ['declaration alias', 'const f = item.fn; f();'],
    ['assignment alias', 'let f; f = item.fn; f();'],
    ['prototype path', 'state.count = Number(item.constructor.name);'],
    ['computed key', 'const box = {}; box[item.key] = 1;'],
    ['member write', 'item.value = 1;'],
    ['member delete', 'delete item.value;'],
    ['member update', 'item.value++;'],
    ['opaque return', 'return item.value;'],
  ])('withholds %s from the scalar element-param channel', (_label, handlerBody) => {
    const result = compileItemHandler(handlerBody);
    const sources = result.files.map((file) => file.source).join('\n');

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV201');
    expect(sources).not.toMatch(/data-p-(?:fn|key|name|value)=/);
    expect(clientSource(result)).not.toMatch(/ctx\.params\.(?:fn|key|name|value)/);
  });

  it('withholds every sibling param when one use of the same render root is unproved', () => {
    const result = compileItemHandler(`
      state.count = Number(item.id);
      function invoke(f) { f(); }
      invoke(item.fn);
    `);
    const sources = result.files.map((file) => file.source).join('\n');

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV201');
    expect(sources).not.toContain('data-p-id');
    expect(sources).not.toContain('data-p-fn');
    expect(clientSource(result)).not.toContain('ctx.params.id');
    expect(clientSource(result)).not.toContain('ctx.params.fn');
  });

  it('withholds a param passed to an unsummarized same-file helper', () => {
    const result = compileComponentModule({
      fileName: 'same-file-helper.tsx',
      source: `
function invoke(value) { value(); }
export const SameFileHelper = component({
  render: ({ item }) => <button onClick={() => { invoke(item.fn); }}>Run</button>,
});
`,
    });
    const sources = result.files.map((file) => file.source).join('\n');

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV201');
    expect(sources).not.toContain('data-p-fn');
    expect(clientSource(result)).not.toContain('ctx.params.fn');
  });

  it('keeps finite arithmetic, comparison, template, and scalar-coercion uses eligible', () => {
    const result = compileItemHandler(`
      if (item.enabled) state.count = Number(item.count) + (item.delta > 0 ? item.delta : 0);
      state.label = \`item:\${String(item.id)}\`;
    `);
    const sources = result.files.map((file) => file.source).join('\n');

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('KV201');
    expect(sources).toContain('data-p-enabled');
    expect(sources).toContain('data-p-count');
    expect(sources).toContain('data-p-delta');
    expect(sources).toContain('data-p-id');
    expect(clientSource(result)).toContain('ctx.params.enabled');
    expect(clientSource(result)).toContain('ctx.params.count');
    expect(clientSource(result)).toContain('ctx.params.delta');
    expect(clientSource(result)).toContain('ctx.params.id');
  });

  it('keeps scalar proof tied to lexical bindings rather than unrelated same-name text', () => {
    const result = compileItemHandler(`
      { const item = { fn() {} }; item.fn(); }
      { const Number = (value) => value; Number(1); }
      state.count = Number(item.id);
    `);
    const sources = result.files.map((file) => file.source).join('\n');

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('KV201');
    expect(sources).toContain('data-p-id');
    expect(clientSource(result)).toContain('ctx.params.id');
  });

  it('keeps an ordinary scalar member capture eligible', () => {
    const result = compileComponentModule({
      fileName: 'scalar-capture.tsx',
      source: `
export const ScalarCapture = component({
  render: ({ item }) => <button onClick={() => { state.count = Number(item.id); }}>Run</button>,
});
`,
    });
    const sources = result.files.map((file) => file.source).join('\n');

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('KV201');
    expect(sources).toContain('data-p-id');
    expect(clientSource(result)).toContain('ctx.params.id');
  });

  it('allows the finite globalThis timer door without making globalThis blanket-safe', () => {
    const allowed = compile(
      'state.count += 1; globalThis.setInterval(() => { clearInterval(0); }, 10);',
    );
    const allowedCodes = allowed.diagnostics.map((diagnostic) => diagnostic.code);
    expect(allowedCodes).not.toContain('KV201');
    expect(allowedCodes).not.toContain('KV449');
    expect(clientSource(allowed)).toContain('globalThis.setInterval');

    for (const body of [`return globalThis.fetch('/unsafe');`, 'return globalThis.__unreviewed;']) {
      const blocked = compile(body);
      expect(blocked.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV449');
    }
  });
});
