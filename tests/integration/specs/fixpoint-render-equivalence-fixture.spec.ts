import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { compileComponentModule } from '../../../packages/compiler/src/index';
import { expect, semanticSnapshot, test } from '@kovojs/test/integration';
import ts from 'typescript';

test.use({ kovoFixture: 'fixpoint-render-equivalence-fixture' });

const componentPath = fileURLToPath(
  new URL('../fixtures/fixpoint-render-equivalence-fixture/fixpoint-card.tsx', import.meta.url),
);
const componentFileName =
  'tests/integration/fixtures/fixpoint-render-equivalence-fixture/fixpoint-card.tsx';

test('SPEC §5.2 fixpoint render output stays semantically equivalent to authored TSX (§4.8)', async ({
  kovoApp,
  page,
}) => {
  const source = await readFile(componentPath, 'utf8');
  const compiled = compileComponentModule({
    fileName: componentFileName,
    source,
  });

  expect(compiled.diagnostics).toEqual([]);
  expect(compiled.renderEquivalenceChecks).toHaveLength(1);
  expect(compiled.renderEquivalenceChecks[0]).toMatchObject({
    artifact:
      'tests/integration/fixtures/fixpoint-render-equivalence-fixture/fixpoint-card.server.js',
    detail:
      'SPEC §5.2 semantic render differential: render(src) differed from render(compile(src)).',
    ok: true,
  });
  expect(compiled.loweredSource).toBeTruthy();

  const loweredSemantic = semanticSnapshot(renderLoweredComponent(compiled.loweredSource ?? ''));

  await page.goto('/');
  const browserSemantic = await kovoApp.semantic('fixpoint-render-equivalence-card');

  expect(loweredSemantic).toBe(browserSemantic);
  expect(browserSemantic).toMatchSnapshot('fixpoint-render-equivalence-fixture.semantic.txt');
});

function renderLoweredComponent(loweredSource: string): string {
  const transpiled = ts.transpileModule(loweredSource, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: '@kovojs/server',
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };

  runInNewContext(transpiled, {
    exports: module.exports,
    module,
    require(specifier: string) {
      if (specifier === '@kovojs/core') {
        return {
          component(definition: unknown) {
            return { definition };
          },
        };
      }
      if (specifier === '@kovojs/runtime') {
        return {
          derive(_inputs: unknown, compute: (state: unknown) => unknown) {
            return compute;
          },
        };
      }
      if (specifier === '@kovojs/server/jsx-runtime') {
        return {
          Fragment(props: { children?: unknown }) {
            return renderJsxChildren(props.children);
          },
          jsx,
          jsxDEV: jsx,
          jsxs: jsx,
        };
      }
      throw new Error(`Unsupported lowered-source import: ${specifier}`);
    },
  });

  const rendered = module.exports.FixpointRenderEquivalenceCard as
    | {
        definition?: {
          render?: (
            queries: Record<string, never>,
            state: { count: number; open: boolean },
          ) => string;
          state?: () => { count: number; open: boolean };
        };
      }
    | undefined;
  const initialState = rendered?.definition?.state?.() ?? { count: 0, open: false };

  return rendered?.definition?.render?.({}, initialState) ?? '';
}

function jsx(type: ((props: JsxProps) => string) | string, props: JsxProps): string {
  if (typeof type === 'function') return type(props);
  const attributes = renderJsxAttributes(props);
  if (VOID_ELEMENTS.has(type)) return `<${type}${attributes}>`;
  return `<${type}${attributes}>${renderJsxChildren(props.children)}</${type}>`;
}

function renderJsxAttributes(props: JsxProps): string {
  let rendered = '';

  for (const [name, value] of Object.entries(props)) {
    if (name === 'children' || value === false || value === null || value === undefined) continue;
    rendered += value === true ? ` ${name}` : ` ${name}="${escapeAttribute(attributeText(value))}"`;
  }

  return rendered;
}

function renderJsxChildren(children: unknown): string {
  if (children === null || children === undefined || typeof children === 'boolean') return '';
  if (Array.isArray(children)) return children.map((child) => renderJsxChildren(child)).join('');
  if (
    typeof children === 'string' ||
    typeof children === 'number' ||
    typeof children === 'bigint'
  ) {
    return children.toString();
  }
  return JSON.stringify(children) ?? '';
}

function attributeText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
  return JSON.stringify(value) ?? '';
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

interface JsxProps {
  children?: unknown;
  [attribute: string]: unknown;
}

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);
