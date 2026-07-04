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
import { trustedHtml, trustedUrl } from '@kovojs/browser';
import { component, queryRef } from '@kovojs/core';
import type { TrustedUrl } from '@kovojs/browser';
import type { JsxChild } from '@kovojs/server/jsx-runtime';

type PanelProps = { title: string; children?: JsxChild };
const Panel = ({ title, children }: PanelProps) => (
  <section aria-label={title} data-panel="true">
    {children}
  </section>
);
const TextOnly = ({ children }: { children: string }) => <span>{children}</span>;
const product = queryRef<'product', { name: string }>('product');
const ProductCard = component({
  props: { productId: String },
  queries: {
    product: product.args((props: { productId: string }) => ({ id: props.productId })),
  },
  render: ({
    children,
    product,
    productId,
    selected = false,
  }: {
    children?: JsxChild;
    product: { name: string };
    productId: string;
    selected?: boolean;
  }) => (
    <article data-product-id={productId} data-selected={selected}>
      <strong>{product.name}</strong>
      {children}
    </article>
  ),
});

const ok = (
  <Panel title="Cart">
    <button type="button" aria-hidden={false} viewTransitionName="cart-button">
      Add
    </button>
  </Panel>
);
const interactive = (
  <form
    onBlur={(event) => void event}
    onChange={(event) => void event}
    onFocus={(event) => void event}
    onInput={(event) => void event}
    onSubmit={(event) => void event}
  >
    <input onInput={(event) => void event} value="filter" />
  </form>
);

const raw = <section html={trustedHtml('<em>safe</em>')} />;
const trustedHref = <a href={trustedUrl('/safe')}>Safe</a>;
const typedTrustedHref: TrustedUrl = trustedUrl('/typed-safe');
const trustedTypedHref = <a href={typedTrustedHref}>Typed safe</a>;
const trustedFormAction = <button formaction={trustedUrl('javascript:reviewed()')}>Go</button>;
const trustedPoster = <video poster={trustedUrl('data:image/png;base64,AAAA')} />;
const streaming = (
  <form enhance stream mutation={{ key: 'chat/send' }}>
    <p streamText="assistant:a1" aria-live="polite" />
  </form>
);
const uploadInput = <input type="file" accept="application/pdf" name="receipt" />;
const kovoComponentOk = (
  <ProductCard productId="p1" selected style={{ color: 'red' }} kovo-key="p1">
    <span>Nested</span>
  </ProductCard>
);
const plainFunctionComponentOk = <Panel title="Still plain"><span>Child</span></Panel>;

// @ts-expect-error SPEC §4.1: component props must be enforced at JSX call sites.
const missingRequiredProp = <Panel />;
// @ts-expect-error SPEC §4.1/§6.2: descriptor component props must be enforced at JSX call sites.
const descriptorMissingRequiredProp = <ProductCard />;
// @ts-expect-error SPEC §4.1/§6.2: descriptor component prop names are exact.
const descriptorWrongPropName = <ProductCard productID="p1" />;
// @ts-expect-error SPEC §4.1/§6.2: descriptor component prop values follow render annotations.
const descriptorWrongValue = <ProductCard productId={1} />;
// @ts-expect-error SPEC §4.1/§6.2: descriptor component queryRef keys are not call-site props.
const descriptorQueryProp = <ProductCard productId="p1" product={{ name: 'Desk' }} />;

// @ts-expect-error SPEC §4.1: declared component children are enforced at JSX call sites.
const badChild = <TextOnly>{{ notRenderable: true }}</TextOnly>;

// @ts-expect-error SPEC §4.8: intrinsic attribute names are closed except data-/aria-/Kovo stamps.
const badAttribute = <button hrefx="/bad">Bad</button>;

// @ts-expect-error SPEC §4.6: known ARIA state values stay typed.
const badAria = <span aria-live="maybe" />;

// @ts-expect-error SPEC §4.8/§6.6: TrustedUrl is scoped to URL-bearing attributes.
const trustedUrlInTitle = <span title={typedTrustedHref}>Bad</span>;

// @ts-expect-error SPEC §4.8/§6.6: TrustedUrl is scoped to URL-bearing attributes.
const trustedUrlInAriaLabel = <span aria-label={typedTrustedHref}>Bad</span>;

void ok;
void interactive;
void raw;
void trustedHref;
void trustedTypedHref;
void trustedFormAction;
void trustedPoster;
void streaming;
void uploadInput;
void kovoComponentOk;
void plainFunctionComponentOk;
void missingRequiredProp;
void descriptorMissingRequiredProp;
void descriptorWrongPropName;
void descriptorWrongValue;
void descriptorQueryProp;
void badChild;
void badAttribute;
void badAria;
void trustedUrlInTitle;
void trustedUrlInAriaLabel;
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
