import { describe, expect, it } from 'vitest';
import ts from 'typescript';

import { compileComponentModule } from './index.js';

// @kovo-security-classifier-corpus client-handler-import
// SPEC §4.3/§5.2: audited values never become executable authority, generated handlers reject
// dynamic-code construction, and only the JSX intrinsic grammar may take the host-event path.

interface ExtraFile {
  fileName: string;
  source: string;
}

function compile(source: string, extraFiles: readonly ExtraFile[] = []) {
  return compileComponentModule({
    fileName: 'client-boundary-security.tsx',
    source,
    extraFiles,
  } as Parameters<typeof compileComponentModule>[0] & { extraFiles: readonly ExtraFile[] });
}

function clientSource(result: ReturnType<typeof compileComponentModule>): string {
  return result.files.find((file) => file.kind === 'client')?.source ?? '';
}

function errorCodes(result: ReturnType<typeof compileComponentModule>): string[] {
  return result.diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.code);
}

function expectClosed(
  result: ReturnType<typeof compileComponentModule>,
  forbidden: readonly string[],
): void {
  const source = clientSource(result);
  expect(
    errorCodes(result).some((code) => code === 'KV201' || code === 'KV437'),
    source,
  ).toBe(true);
  expect(result.handlerExports).toEqual([]);
  for (const value of forbidden) expect(source).not.toContain(value);
}

function expectOpen(
  result: ReturnType<typeof compileComponentModule>,
  required: readonly string[],
): void {
  const source = clientSource(result);
  expect(errorCodes(result), JSON.stringify(result.diagnostics)).toEqual([]);
  expect(result.handlerExports.length, source).toBeGreaterThan(0);
  for (const value of required) expect(source).toContain(value);
}

describe('publishToClient value-only executable boundary', () => {
  for (const [label, handlerBody] of [
    [
      'direct invocation',
      `return publishToClient(execFileSync, { reason: 'reviewed public callable' })('id');`,
    ],
    [
      'call protocol',
      `return publishToClient(execFileSync, { reason: 'reviewed public callable' }).call(null, 'id');`,
    ],
    [
      'apply protocol',
      `return publishToClient(execFileSync, { reason: 'reviewed public callable' }).apply(null, ['id']);`,
    ],
    [
      'bind protocol',
      `return publishToClient(execFileSync, { reason: 'reviewed public callable' }).bind(null, 'id')();`,
    ],
    [
      'new protocol',
      `return new (publishToClient(execFileSync, { reason: 'reviewed public callable' }))('id');`,
    ],
    [
      'local alias',
      `const run = publishToClient(execFileSync, { reason: 'reviewed public callable' }); return run('id');`,
    ],
    [
      'array destructuring alias',
      `const [run] = [publishToClient(execFileSync, { reason: 'reviewed public callable' })]; return run('id');`,
    ],
    [
      'object destructuring alias',
      `const { run } = { run: publishToClient(execFileSync, { reason: 'reviewed public callable' }) }; return run('id');`,
    ],
    [
      'container member invocation',
      `return ({ run: publishToClient(execFileSync, { reason: 'reviewed public callable' }) }).run('id');`,
    ],
    [
      'higher-order Promise callback',
      `return Promise.resolve(publishToClient(execFileSync, { reason: 'reviewed public callable' })).then((run) => run('id'));`,
    ],
  ] as const) {
    it(`closes ${label} and omits the entire handler/import`, () => {
      const result = compile(`
        import { component, publishToClient } from '@kovojs/core';
        import { execFileSync } from 'node:child_process';
        export const Page = component({
          render: () => <button onClick={() => { ${handlerBody} }}>Go</button>,
        });
      `);
      expectClosed(result, ['node:child_process', 'execFileSync', 'reviewed public callable']);
      expect(JSON.stringify(result.clientModuleImportManifest)).not.toContain('node:child_process');
    });
  }

  it('preserves an audited non-callable value in an ordinary value position', () => {
    const result = compile(`
      import { component, publishToClient } from '@kovojs/core';
      const PUBLIC_VALUE = 'public value';
      export const Page = component({
        render: () => <button onClick={() => String(publishToClient(
          PUBLIC_VALUE,
          { reason: 'reviewed public value' },
        ))}>Go</button>,
      });
    `);
    expectOpen(result, ["const PUBLIC_VALUE = 'public value';", 'PUBLIC_VALUE']);
  });

  it('never emits an imported module for a published value assertion', () => {
    const result = compile(
      `
        import { component, publishToClient } from '@kovojs/core';
        import { PUBLIC_VALUE } from './evil-public-value.js';
        export const Page = component({
          render: () => <button onClick={() => String(publishToClient(
            PUBLIC_VALUE,
            { reason: 'claimed public value' },
          ))}>Go</button>,
        });
      `,
      [
        {
          fileName: 'evil-public-value.ts',
          source: `globalThis.__import_side_effect__ = true; export const PUBLIC_VALUE = 'public';`,
        },
      ],
    );
    expectClosed(result, ['./evil-public-value.js', 'PUBLIC_VALUE', '__import_side_effect__']);
    expect(result.publishToClientFacts).toEqual([]);
  });

  for (const [label, declaration, extraFiles] of [
    ['let binding', `let PUBLIC_VALUE = 'public';`, []],
    ['var binding', `var PUBLIC_VALUE = 'public';`, []],
    [
      'duplicate module binding',
      `const PUBLIC_VALUE = 'first'; const PUBLIC_VALUE = 'second';`,
      [],
    ],
    ['missing initializer', `const PUBLIC_VALUE;`, []],
    ['array carrier', `const PUBLIC_VALUE = ['public'];`, []],
    ['plain object carrier', `const PUBLIC_VALUE = { value: 'public' };`, []],
    ['getter carrier', `const PUBLIC_VALUE = { get value() { return 'public'; } };`, []],
    [
      'spread object carrier',
      `const BASE = { value: 'public' }; const PUBLIC_VALUE = { ...BASE };`,
      [],
    ],
    [
      'alias to imported value',
      `import { IMPORTED_VALUE } from './evil-public-value.js'; const PUBLIC_VALUE = IMPORTED_VALUE;`,
      [
        {
          fileName: 'evil-public-value.ts',
          source: `globalThis.__import_side_effect__ = true; export const IMPORTED_VALUE = 'public';`,
        },
      ],
    ],
  ] as const) {
    it(`refuses ${label} as a published client carrier`, () => {
      const result = compile(
        `
          import { component, publishToClient } from '@kovojs/core';
          ${declaration}
          export const Page = component({
            render: () => <button onClick={() => String(publishToClient(
              PUBLIC_VALUE,
              { reason: 'claimed inert value' },
            ))}>Go</button>,
          });
        `,
        extraFiles,
      );
      expectClosed(result, ['claimed inert value']);
      expect(result.publishToClientFacts).toEqual([]);
    });
  }

  it('keeps a handler-local primitive shadow distinct from the module const', () => {
    const result = compile(`
      import { component, publishToClient } from '@kovojs/core';
      const PUBLIC_VALUE = 'module value';
      export const Page = component({
        render: () => <button onClick={() => {
          const PUBLIC_VALUE = 'handler value';
          return publishToClient(PUBLIC_VALUE, { reason: 'local primitive shadow' });
        }}>Go</button>,
      });
    `);
    expectOpen(result, ["const PUBLIC_VALUE = 'handler value';", 'local primitive shadow']);
    expect(clientSource(result)).not.toContain("const PUBLIC_VALUE = 'module value';");
    expect(result.publishToClientFacts).toEqual([]);
  });

  for (const [label, declaration] of [
    ['string', `const PUBLIC_VALUE = 'public';`],
    ['number', `const PUBLIC_VALUE = -42;`],
    ['boolean', `const PUBLIC_VALUE = true;`],
    ['null', `const PUBLIC_VALUE = null;`],
  ] as const) {
    it(`snapshots one pristine same-file const ${label}`, () => {
      const result = compile(`
        import { component, publishToClient } from '@kovojs/core';
        ${declaration}
        export const Page = component({
          render: () => <button onClick={() => publishToClient(
            PUBLIC_VALUE,
            { reason: 'compiler-snapshotted primitive' },
          )}>Go</button>,
        });
      `);
      expectOpen(result, ['const PUBLIC_VALUE =', 'compiler-snapshotted primitive']);
      expect(result.publishToClientFacts).toEqual([
        expect.objectContaining({
          localName: 'PUBLIC_VALUE',
          moduleSpecifier: 'client-boundary-security.tsx#module-scope',
        }),
      ]);
    });
  }

  it('keeps namespace publication closed independently of result-use analysis', () => {
    const result = compile(`
      import { component, publishToClient } from '@kovojs/core';
      import * as child from 'node:child_process';
      export const Page = component({
        render: () => <button onClick={() => publishToClient(
          child,
          { reason: 'reviewed public callable namespace' },
        ).execFileSync('id')}>Go</button>,
      });
    `);
    expectClosed(result, ['node:child_process', 'child']);
  });

  for (const [label, handlerBody] of [
    [
      'arrow-return carrier',
      `const get = () => publishToClient(execFileSync, { reason: 'reviewed carrier' }); return get()('id');`,
    ],
    [
      'function-declaration return carrier',
      `function get() { return publishToClient(execFileSync, { reason: 'reviewed carrier' }); } return get()('id');`,
    ],
    [
      'callback return carrier',
      `return [0].map(() => publishToClient(execFileSync, { reason: 'reviewed carrier' }))[0]('id');`,
    ],
    [
      'default-parameter carrier',
      `const get = (run = publishToClient(execFileSync, { reason: 'reviewed carrier' })) => run; return get()('id');`,
    ],
    [
      'object-method carrier',
      `const box = { get() { return publishToClient(execFileSync, { reason: 'reviewed carrier' }); } }; return box.get()('id');`,
    ],
    [
      'object-getter carrier',
      `const box = { get run() { return publishToClient(execFileSync, { reason: 'reviewed carrier' }); } }; return box.run('id');`,
    ],
    [
      'class-field carrier',
      `class Box { run = publishToClient(execFileSync, { reason: 'reviewed carrier' }); } return new Box().run('id');`,
    ],
    [
      'published property accessor',
      `return publishToClient(execFileSync, { reason: 'reviewed carrier' }).name;`,
    ],
    [
      'published computed accessor',
      `return publishToClient(execFileSync, { reason: 'reviewed carrier' })['name'];`,
    ],
    [
      'tainted inner lexical binding despite an outer shadow',
      `const run = () => 'outer'; { const run = publishToClient(execFileSync, { reason: 'reviewed carrier' }); return run('id'); }`,
    ],
    [
      'object destructuring assignment',
      `let run; ({ run } = { run: publishToClient(execFileSync, { reason: 'reviewed carrier' }) }); return run('id');`,
    ],
    [
      'array destructuring assignment',
      `let run; [run] = [publishToClient(execFileSync, { reason: 'reviewed carrier' })]; return run('id');`,
    ],
  ] as const) {
    it(`closes ${label} and omits its carrier`, () => {
      const result = compile(`
        import { component, publishToClient } from '@kovojs/core';
        import { execFileSync } from 'node:child_process';
        export const Page = component({
          render: () => <button onClick={() => { ${handlerBody} }}>Go</button>,
        });
      `);
      expectClosed(result, ['node:child_process', 'execFileSync', 'reviewed carrier']);
    });
  }
});

describe('client-handler dynamic-code boundary', () => {
  for (const [label, handlerBody] of [
    ['arrow constructor', `return (() => 0).constructor('return globalThis')();`],
    [
      'ordinary-function constructor',
      `return (function () {}).constructor('return globalThis')();`,
    ],
    [
      'generator-function constructor',
      `return (function* () {}).constructor('return globalThis')().next();`,
    ],
    [
      'async-function constructor',
      `return (async function () {}).constructor('return globalThis')();`,
    ],
    [
      'async-generator constructor',
      `return (async function* () {}).constructor('return globalThis')().next();`,
    ],
    ['class constructor', `return (class {}).constructor('return globalThis')();`],
    ['allowed Object constructor', `return Object.constructor('return globalThis')();`],
    ['literal constructor chain', `return [].constructor.constructor('return globalThis')();`],
    [
      'async-function prototype constructor',
      `return Object.getPrototypeOf(async function () {}).constructor('return globalThis')();`,
    ],
    ['computed constructor property', `return (() => 0)['constructor']('return globalThis')();`],
    [
      'constant-folded constructor property',
      `return (() => 0)['con' + 'structor']('return globalThis')();`,
    ],
    [
      'local member alias',
      `const Ctor = (() => 0).constructor; return Ctor('return globalThis')();`,
    ],
    [
      'computed destructured member alias',
      `const { ['constructor']: Ctor } = (() => 0); return Ctor('return globalThis')();`,
    ],
    ['legacy proto chain', `return (() => 0).__proto__.constructor('return globalThis')();`],
    [
      'reflective descriptor extraction',
      `return Object.getOwnPropertyDescriptor(Object.getPrototypeOf(() => 0), 'constructor').value('return globalThis')();`,
    ],
    ['raw event prototype chain', `return event.constructor.constructor('return globalThis')();`],
    [
      'framework ctx prototype chain',
      `return ctx.state.constructor.constructor('return globalThis')();`,
    ],
  ] as const) {
    it(`closes ${label} and emits no dynamic source`, () => {
      const result = compile(`
        import { component } from '@kovojs/core';
        export const Page = component({
          render: () => <button onClick={() => { ${handlerBody} }}>Go</button>,
        });
      `);
      expectClosed(result, ['constructor', 'return globalThis']);
    });
  }

  it('closes browser string-timer code and omits the handler', () => {
    const result = compile(`
      import { component } from '@kovojs/core';
      export const Page = component({
        render: () => <button onClick={() => setTimeout(
          'globalThis.__timer_code__ = true',
          0,
        )}>Go</button>,
      });
    `);
    expectClosed(result, ['setTimeout', 'globalThis.__timer_code__']);
  });

  for (const [label, handlerBody, forbidden] of [
    ['direct eval', `return eval('globalThis.__eval_code__ = true');`, '__eval_code__'],
    ['optional eval', `return eval?.('globalThis.__eval_code__ = true');`, '__eval_code__'],
    ['indirect eval', `return (0, eval)('globalThis.__eval_code__ = true');`, '__eval_code__'],
    [
      'aliased eval',
      `const run = eval; return run('globalThis.__eval_code__ = true');`,
      '__eval_code__',
    ],
    ['direct Function', `return Function('return globalThis')();`, 'return globalThis'],
    ['new Function', `return new Function('return globalThis')();`, 'return globalThis'],
    ['optional Function', `return Function?.('return globalThis')();`, 'return globalThis'],
    [
      'globalThis Function',
      `return globalThis.Function('return globalThis')();`,
      'return globalThis',
    ],
    [
      'window computed Function',
      `return window['Function']('return globalThis')();`,
      'return globalThis',
    ],
    ['self eval', `return self.eval('globalThis.__eval_code__ = true');`, '__eval_code__'],
    [
      'globalThis string timeout',
      `return globalThis.setTimeout('globalThis.__timer_code__ = true', 0);`,
      '__timer_code__',
    ],
    [
      'window string interval',
      `return window['setInterval'](\`globalThis.__timer_code__ = true\`, 0);`,
      '__timer_code__',
    ],
    [
      'self computed string timeout',
      `return self['setTimeout'](String('globalThis.__timer_code__ = true'), 0);`,
      '__timer_code__',
    ],
    [
      'string-code local alias',
      `const code = 'globalThis.__timer_code__ = true'; return setTimeout(code, 0);`,
      '__timer_code__',
    ],
    [
      'bare timer authority alias',
      `const timer = setTimeout; return timer('globalThis.__timer_code__ = true', 0);`,
      '__timer_code__',
    ],
    [
      'global member timer authority alias',
      `const timer = globalThis.setTimeout; return timer('globalThis.__timer_code__ = true', 0);`,
      '__timer_code__',
    ],
  ] as const) {
    it(`closes ${label} as global dynamic-code authority`, () => {
      const result = compile(`
        import { component } from '@kovojs/core';
        export const Page = component({
          render: () => <button onClick={() => { ${handlerBody} }}>Go</button>,
        });
      `);
      expectClosed(result, [forbidden]);
    });
  }

  for (const [label, handlerBody] of [
    ['local eval', `const eval = (source) => source; return eval('safe value');`],
    [
      'local Function',
      `const Function = (source) => () => source; return Function('safe value')();`,
    ],
    [
      'local setTimeout',
      `const setTimeout = (source) => source; return setTimeout('safe value', 0);`,
    ],
    [
      'local globalThis object',
      `const globalThis = { Function: (source) => () => source, setTimeout: (source) => source }; return globalThis.Function('safe value')() + globalThis.setTimeout('safe value', 0);`,
    ],
    [
      'local window object',
      `const window = { eval: (source) => source, setInterval: (source) => source }; return window.eval('safe value') + window.setInterval('safe value', 0);`,
    ],
  ] as const) {
    it(`does not confuse ${label} with a global dynamic-code identity`, () => {
      const result = compile(`
        import { component } from '@kovojs/core';
        export const Page = component({
          render: () => <button onClick={() => { ${handlerBody} }}>Go</button>,
        });
      `);
      expectOpen(result, ['safe value']);
    });
  }

  it('closes direct and aliased published string timer code', () => {
    for (const handlerBody of [
      `return setTimeout(publishToClient(PUBLIC_CODE, { reason: 'reviewed timer text' }), 0);`,
      `const code = publishToClient(PUBLIC_CODE, { reason: 'reviewed timer text' }); return setInterval(code, 0);`,
    ]) {
      const result = compile(`
        import { component, publishToClient } from '@kovojs/core';
        const PUBLIC_CODE = 'globalThis.__timer_code__ = true';
        export const Page = component({
          render: () => <button onClick={() => { ${handlerBody} }}>Go</button>,
        });
      `);
      expectClosed(result, ['PUBLIC_CODE', 'reviewed timer text', '__timer_code__']);
    }
  });

  it('allows global timers only with a syntactically proven callback function', () => {
    for (const handlerBody of [
      `return setTimeout(() => { globalThis.__callback_ran__ = true; }, 0);`,
      `return globalThis.setInterval(function () { globalThis.__callback_ran__ = true; }, 10);`,
    ]) {
      const result = compile(`
        import { component } from '@kovojs/core';
        export const Page = component({
          render: () => <button onClick={() => { ${handlerBody} }}>Go</button>,
        });
      `);
      expectOpen(result, ['set', 'callbackRan']);
    }
  });
});

describe('JSX intrinsic/component lexical boundary', () => {
  for (const [label, declarationName, tag] of [
    ['leading underscore', '_Child', '_Child'],
    ['leading dollar', '$Child', '$Child'],
    ['non-ASCII upper-case letter', 'ÉChild', 'ÉChild'],
    ['non-ASCII lower-case letter', 'éChild', 'éChild'],
    ['CJK identifier', '中Child', '中Child'],
    ['escaped underscore declaration', '\\u005fEscaped', '_Escaped'],
  ] as const) {
    it(`treats an unresolved ${label} identifier as a component boundary`, () => {
      const result = compile(`
        import { component } from '@kovojs/core';
        import { tabsKeyDown } from '@kovojs/headless-ui/tabs';
        const ${declarationName} = component({ render: () => <span>Child</span> });
        export const Page = component({
          render: () => <${tag} onClick={() => tabsKeyDown()}>Go</${tag}>,
        });
      `);
      expectClosed(result, ['tabsKeyDown', '@kovojs/headless-ui/generated']);
    });
  }

  it('treats a static event spread on a leading-underscore tag as a component boundary', () => {
    const result = compile(`
      import { component } from '@kovojs/core';
      import { tabsKeyDown } from '@kovojs/headless-ui/tabs';
      const _Child = component({ render: () => <span>Child</span> });
      export const Page = component({
        render: () => <_Child {...{ onClick: () => tabsKeyDown() }} />,
      });
    `);
    expectClosed(result, ['tabsKeyDown', '@kovojs/headless-ui/generated']);
  });

  it('keeps an ASCII member tag on the unresolved component boundary', () => {
    const result = compile(`
      import { component } from '@kovojs/core';
      import { tabsKeyDown } from '@kovojs/headless-ui/tabs';
      const Leaf = component({ render: () => <span>Child</span> });
      const UI = { Child: Leaf };
      export const Page = component({
        render: () => <UI.Child onClick={() => tabsKeyDown()}>Go</UI.Child>,
      });
    `);
    expectClosed(result, ['tabsKeyDown']);
    expect(errorCodes(result)).toEqual(['KV201']);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).not.toContain(
      expect.stringContaining('Cannot redeclare'),
    );
  });

  for (const tag of ['child-name', 'ns:child'] as const) {
    it(`preserves intrinsic host grammar ${tag}`, () => {
      const result = compile(`
        import { component } from '@kovojs/core';
        import { tabsKeyDown } from '@kovojs/headless-ui/tabs';
        export const Page = component({
          render: () => <${tag} onClick={() => tabsKeyDown()}>Go</${tag}>,
        });
      `);
      expectOpen(result, ['@kovojs/headless-ui/generated', 'tabsKeyDown()']);
    });
  }

  it('keeps JSX Unicode escape spellings outside the valid tag grammar', () => {
    for (const tag of ['\\u0043hild', '\\u005fChild']) {
      const sourceFile = ts.createSourceFile(
        'escape-control.tsx',
        `const value = <${tag} onClick={() => 1} />;`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      expect(sourceFile.parseDiagnostics.map((diagnostic) => diagnostic.messageText)).toContain(
        'Unicode escape sequence cannot appear here.',
      );
    }
  });
});
