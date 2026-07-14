import { describe, expect, it } from 'vitest';

import {
  reviewedCanonicalClientHandlerImportTarget,
  reviewedClientHandlerImportTarget,
} from './client-handler-import-policy.js';
import { compileComponentModule } from './index.js';
import { headlessUiClientExecutableImports } from './generated/headless-ui-client-executables.js';

// @kovo-security-classifier-corpus client-handler-import
// SPEC §5.2: generated browser handlers accept executable imports only through a finite exact
// compiler registry or compiler-proven local re-export of one of those identities.

interface ExtraFile {
  fileName: string;
  source: string;
}

function compile(source: string, extraFiles: readonly ExtraFile[] = []) {
  return compileComponentModule({ fileName: 'page.tsx', source, extraFiles } as Parameters<
    typeof compileComponentModule
  >[0] & { extraFiles: readonly ExtraFile[] });
}

function clientSource(result: ReturnType<typeof compileComponentModule>): string {
  return result.files.find((file) => file.kind === 'client')?.source ?? '';
}

function expectClosed(
  result: ReturnType<typeof compileComponentModule>,
  forbidden: readonly string[],
): void {
  const client = clientSource(result);
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV201');
  expect(result.handlerExports).toEqual([]);
  for (const text of forbidden) expect(client).not.toContain(text);
  expect(JSON.stringify(result.clientModuleImportManifest)).not.toContain(forbidden[0] ?? '');
}

describe('exact client-handler executable import policy', () => {
  const closedCases = [
    {
      forbidden: ['node:child_process', 'execFileSync'],
      label: 'direct Node builtin call',
      source: `import { execFileSync } from 'node:child_process';
        export const Page = component({ render: () => <button onClick={() => execFileSync('id')}>Go</button> });`,
    },
    {
      forbidden: ['node:child_process', 'run'],
      label: 'aliased Node builtin call',
      source: `import { execFileSync as run } from 'node:child_process';
        export const Page = component({ render: () => <button onClick={() => run('id')}>Go</button> });`,
    },
    {
      forbidden: ['node:child_process', 'execFileSync'],
      label: 'bare named Node handler',
      source: `import { execFileSync } from 'node:child_process';
        export const Page = component({ render: () => <button onClick={execFileSync}>Go</button> });`,
    },
    {
      forbidden: ['node:child_process', 'execFileSync'],
      label: 'call apply bind and optional call laundering',
      source: `import { execFileSync } from 'node:child_process';
        export const Page = component({ render: () => <button onClick={() => {
          execFileSync.call(null, 'call'); execFileSync.apply(null, ['apply']);
          execFileSync.bind(null, 'bind')(); execFileSync?.('optional');
        }}>Go</button> });`,
    },
    {
      forbidden: ['node:child_process', 'child'],
      label: 'namespace import',
      source: `import * as child from 'node:child_process';
        export const Page = component({ render: () => <button onClick={() => child.execFileSync('id')}>Go</button> });`,
    },
    {
      forbidden: ['node:child_process', 'child'],
      label: 'default import',
      source: `import child from 'node:child_process';
        export const Page = component({ render: () => <button onClick={() => child.execFileSync('id')}>Go</button> });`,
    },
    {
      forbidden: ['./client-actions.js', 'run'],
      label: 'arbitrary relative callable',
      source: `import { run } from './client-actions.js';
        export const Page = component({ render: () => <button onClick={() => run()}>Go</button> });`,
    },
    {
      forbidden: ['unreviewed-package', 'run'],
      label: 'arbitrary bare-package callable',
      source: `import { run } from 'unreviewed-package';
        export const Page = component({ render: () => <button onClick={() => run()}>Go</button> });`,
    },
    {
      forbidden: ['node:child_process', 'run'],
      label: 'module alias',
      source: `import { execFileSync } from 'node:child_process'; const run = execFileSync;
        export const Page = component({ render: () => <button onClick={() => run('id')}>Go</button> });`,
    },
    {
      forbidden: ['node:child_process', 'run'],
      label: 'module wrapper',
      source: `import { execFileSync } from 'node:child_process';
        function run(value) { return execFileSync(value); }
        export const Page = component({ render: () => <button onClick={() => run('id')}>Go</button> });`,
    },
    {
      forbidden: ['node:child_process', 'import('],
      label: 'dynamic import',
      source: `export const Page = component({ render: () => <button onClick={() =>
        import('node:child_process').then((child) => child.execFileSync('id'))}>Go</button> });`,
    },
    {
      forbidden: ['node:child_process', 'execFileSync'],
      label: 'CommonJS require',
      source: `const { execFileSync } = require('node:child_process');
        export const Page = component({ render: () => <button onClick={() => execFileSync('id')}>Go</button> });`,
    },
    {
      forbidden: ['node:child_process', 'child'],
      label: 'TypeScript import equals',
      source: `import child = require('node:child_process');
        export const Page = component({ render: () => <button onClick={() => child.execFileSync('id')}>Go</button> });`,
    },
    {
      forbidden: ['@kovojs/headless-ui/tabs-extra', 'tabsKeyDown'],
      label: 'package-prefix lookalike',
      source: `import { tabsKeyDown } from '@kovojs/headless-ui/tabs-extra';
        export const Page = component({ render: () => <button onClick={() => tabsKeyDown()}>Go</button> });`,
    },
    {
      forbidden: ['@kovojs/headless-ui/tabs', 'tabsKeyDownForged'],
      label: 'export-name lookalike',
      source: `import { tabsKeyDownForged } from '@kovojs/headless-ui/tabs';
        export const Page = component({ render: () => <button onClick={() => tabsKeyDownForged()}>Go</button> });`,
    },
    {
      forbidden: ['node:child_process', 'Exec'],
      label: 'type-only import used as a value',
      source: `import type { execFileSync as Exec } from 'node:child_process';
        export const Page = component({ render: () => <button onClick={() => Exec()}>Go</button> });`,
    },
    {
      forbidden: ['import.meta', 'KOVO_ENV_SECRET_AUDIT'],
      label: 'import.meta authority',
      source: `export const Page = component({ render: () => <button onClick={() =>
        String(import.meta.env.KOVO_ENV_SECRET_AUDIT)}>Go</button> });`,
    },
  ] as const;

  for (const item of closedCases) {
    it(`closes ${item.label}`, () => {
      expectClosed(compile(item.source), item.forbidden);
    });
  }

  for (const [label, markup] of [
    ['inline host spread', `<button {...{ onClick: () => execFileSync('inline') }} />`],
    ['module host spread', `<button {...hostileProps} />`],
  ] as const) {
    it(`closes ${label}`, () => {
      expectClosed(
        compile(`import { execFileSync } from 'node:child_process';
          const hostileProps = { onClick: () => execFileSync('module') };
          export const Page = component({ render: () => (${markup}) });`),
        ['node:child_process', 'execFileSync'],
      );
    });
  }

  for (const [label, expression] of [
    ['constructor property', `tabsKeyDown.constructor('return 1')()`],
    ['computed constructor property', `tabsKeyDown['constructor']('return 1')()`],
    ['prototype constructor', `Object.getPrototypeOf(tabsKeyDown).constructor('return 1')()`],
  ] as const) {
    it(`does not widen reviewed handler identity through ${label}`, () => {
      expectClosed(
        compile(`import { tabsKeyDown } from '@kovojs/headless-ui/tabs';
          export const Page = component({ render: () => <button onClick={() => ${expression}}>Go</button> });`),
        ['tabsKeyDown'],
      );
    });
  }

  it('allows an exact reviewed Headless UI callable and normalizes its module', () => {
    const result = compile(`import { tabsKeyDown as runTabs } from '@kovojs/headless-ui/tabs';
      export const Page = component({ render: () => <button onClick={() => runTabs()}>Go</button> });`);
    const client = clientSource(result);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('KV201');
    expect(client).toContain(
      'import { tabsKeyDown as runTabs } from "@kovojs/headless-ui/generated";',
    );
    expect(client).not.toContain('@kovojs/headless-ui/tabs"');
    expect(result.clientModuleImportManifest).toContainEqual({
      imports: [{ importedName: 'tabsKeyDown', localName: 'runTabs' }],
      moduleSpecifier: '@kovojs/headless-ui/generated',
    });
  });

  it('proves a local re-export alias and projects the canonical name into code and manifest', () => {
    const result = compile(
      `import { safeTabs } from './actions.js';
       export const Page = component({ render: () => <button onClick={() => safeTabs()}>Go</button> });`,
      [
        {
          fileName: 'actions.ts',
          source: `export { tabsKeyDown as safeTabs } from '@kovojs/headless-ui/tabs';`,
        },
      ],
    );
    const client = clientSource(result);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('KV201');
    expect(client).toContain(
      'import { tabsKeyDown as safeTabs } from "@kovojs/headless-ui/generated";',
    );
    expect(client).not.toContain('./actions.js');
    expect(result.clientModuleImportManifest).toContainEqual({
      imports: [{ importedName: 'tabsKeyDown', localName: 'safeTabs' }],
      moduleSpecifier: '@kovojs/headless-ui/generated',
    });
  });

  it('refuses an audited value import because module evaluation is executable authority', () => {
    const result = compile(`import { publishToClient } from '@kovojs/core';
      import { PUBLIC_VALUE } from './public-config.js';
      export const Page = component({ render: () => <button onClick={() =>
        publishToClient(PUBLIC_VALUE, { reason: 'public browser configuration' })}>Go</button> });`);
    const client = clientSource(result);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV437');
    expect(client).not.toContain('import { PUBLIC_VALUE } from "./public-config.js";');
    expect(result.publishToClientFacts).toEqual([]);
  });

  it('blocks every handler sharing a globally withheld binding', () => {
    const result = compile(`import { publishToClient } from '@kovojs/core';
      import { value } from './unreviewed.js';
      export const Page = component({ render: () => <div>
        <button onClick={() => publishToClient(value, { reason: 'public value' })}>A</button>
        <button onClick={() => value()}>B</button>
      </div> });`);
    expectClosed(result, ['./unreviewed.js', 'value']);
    expect(clientSource(result)).not.toContain('Page$button_click');
  });

  it('does not let a sibling nested-block declaration shadow an outer import use', () => {
    const result = compile(`import { execFileSync } from 'node:child_process';
      export const Page = component({ render: () => <button onClick={() => {
        execFileSync('outer'); { const execFileSync = () => undefined; execFileSync(); }
      }}>Go</button> });`);
    expectClosed(result, ['node:child_process', 'execFileSync']);
  });

  it('respects a genuine same-block lexical shadow without importing Node authority', () => {
    const result = compile(`import { execFileSync } from 'node:child_process';
      export const Page = component({ render: () => <button onClick={() => {
        const execFileSync = () => undefined; execFileSync();
      }}>Go</button> });`);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('KV201');
    expect(clientSource(result)).not.toContain('node:child_process');
  });
});

describe('client-handler registry integrity', () => {
  it('requires an exact reviewed module and export pair plus canonical identity', () => {
    expect(
      reviewedClientHandlerImportTarget('@kovojs/headless-ui/tabs', 'tabsKeyDown', 'named'),
    ).toBe('@kovojs/headless-ui/generated');
    expect(
      reviewedClientHandlerImportTarget('@kovojs/headless-ui/tabs-extra', 'tabsKeyDown', 'named'),
    ).toBeUndefined();
    expect(
      reviewedClientHandlerImportTarget('@kovojs/headless-ui/tabs', 'tabsKeyDownForged', 'named'),
    ).toBeUndefined();
    expect(
      reviewedClientHandlerImportTarget('@kovojs/headless-ui/tabs', 'tabsKeyDown', 'namespace'),
    ).toBeUndefined();
    expect(reviewedCanonicalClientHandlerImportTarget('@kovojs/headless-ui', 'tabsKeyDown')).toBe(
      '@kovojs/headless-ui/generated',
    );
  });

  it('snapshots generated registry data before later mutation attempts', () => {
    const mutable = headlessUiClientExecutableImports as unknown as Array<{
      importedNames: string[];
      moduleSpecifier: string;
    }>;
    const first = mutable[0]!;
    const original = first.importedNames[0]!;
    first.importedNames[0] = 'forgedHandler';
    try {
      expect(reviewedClientHandlerImportTarget(first.moduleSpecifier, original, 'named')).toBe(
        '@kovojs/headless-ui/generated',
      );
      expect(
        reviewedClientHandlerImportTarget(first.moduleSpecifier, 'forgedHandler', 'named'),
      ).toBeUndefined();
    } finally {
      first.importedNames[0] = original;
    }
  });
});
