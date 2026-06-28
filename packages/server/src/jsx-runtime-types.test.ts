import { execFileSync, type ExecFileSyncOptionsWithBufferEncoding } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function resolveBin(name: string): string {
  return join(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${name}.cmd` : name,
  );
}

function execFileSyncWithDiagnostics(
  file: string,
  args: readonly string[],
  options: ExecFileSyncOptionsWithBufferEncoding,
): void {
  try {
    execFileSync(file, [...args], options);
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString('utf8') ?? '';
    const stdout = (error as { stdout?: Buffer }).stdout?.toString('utf8') ?? '';
    throw new Error([stdout, stderr].filter(Boolean).join('\n'));
  }
}

describe('server JSX runtime types', () => {
  it('type-checks component props, renderable children, and intrinsic attributes', () => {
    const root = mkdtempSync(join(process.cwd(), 'packages/server/.tmp-jsx-types-'));
    try {
      writeFileSync(
        join(root, 'jsx-type-proof.tsx'),
        `
/** @jsxImportSource @kovojs/server */
import { trustedHtml } from '@kovojs/browser';
import type { JsxChild } from '@kovojs/server/jsx-runtime';

type PanelProps = { title: string; children?: JsxChild };
const Panel = ({ title, children }: PanelProps) => (
  <section aria-label={title} data-panel="true">
    {children}
  </section>
);
const TextOnly = ({ children }: { children: string }) => <span>{children}</span>;

const ok = (
  <Panel title="Cart">
    <button type="button" aria-hidden={false} viewTransitionName="cart-button">
      Add
    </button>
  </Panel>
);

const raw = <section html={trustedHtml('<em>safe</em>')} />;

// @ts-expect-error SPEC §4.1: component props must be enforced at JSX call sites.
const missingRequiredProp = <Panel />;

// @ts-expect-error SPEC §4.1: declared component children are enforced at JSX call sites.
const badChild = <TextOnly>{{ notRenderable: true }}</TextOnly>;

// @ts-expect-error SPEC §4.8: intrinsic attribute names are closed except data-/aria-/Kovo stamps.
const badAttribute = <button hrefx="/bad">Bad</button>;

// @ts-expect-error SPEC §4.6: known ARIA state values stay typed.
const badAria = <span aria-live="maybe" />;

void ok;
void raw;
void missingRequiredProp;
void badChild;
void badAttribute;
void badAria;
`,
        'utf8',
      );
      writeFileSync(
        join(root, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              allowImportingTsExtensions: true,
              exactOptionalPropertyTypes: true,
              jsx: 'react-jsx',
              jsxImportSource: '@kovojs/server',
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              noEmit: true,
              noUncheckedIndexedAccess: true,
              skipLibCheck: true,
              strict: true,
              target: 'ES2024',
              types: ['node'],
              verbatimModuleSyntax: true,
            },
            include: ['jsx-type-proof.tsx'],
          },
          null,
          2,
        ),
        'utf8',
      );

      expect(() =>
        execFileSyncWithDiagnostics(resolveBin('tsc'), ['-p', join(root, 'tsconfig.json')], {
          cwd: process.cwd(),
          stdio: 'pipe',
        }),
      ).not.toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
