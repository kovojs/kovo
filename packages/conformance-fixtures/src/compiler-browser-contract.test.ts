import {
  applyCompiledQueryUpdatePlan,
  derive,
  kovoEscapeHtml,
  kovoStyleProperty,
  runQueryUpdatePlan,
} from '@kovojs/browser/generated';
import { createQueryStore } from '@kovojs/browser/client';
import { createDbVerifier } from '@kovojs/test/internal/verifier';
import { describe, expect, it } from 'vitest';

import { applyInlineMutationResponseChunks } from '../../browser/src/inline-response-apply.js';
import { applyMutationResponseChunksToRuntime } from '../../browser/src/apply-mutation-response.js';
import { applyQueryChunksToRuntime } from '../../browser/src/query-apply.js';
import {
  readQueryElementChunk,
  readMutationResponseBodyChunks,
} from '../../browser/src/wire-parser.js';
import { readInlineMutationResponseBodyChunks } from '../../browser/src/wire-response-scanner.js';
import { compileComponentModule } from '../../compiler/src/index.js';
import {
  executeGeneratedClientArtifact,
  GeneratedFixtureElement,
  GeneratedFixtureMorphRoot,
  GeneratedFixtureMorphTarget,
  GeneratedFixtureTemplateStampHost,
} from './generated-module-fixtures.js';
import { crossPackageOracleFixture } from './oracle-fixtures.js';
import { createVerificationFakeDb } from './verification-fixtures.js';

describe('compiler/browser oracle contract', () => {
  it('executes one fixture through compiled query plans, modular wire apply, inline apply, and verifier coverage', () => {
    const fixture = crossPackageOracleFixture();
    const compiled = compileComponentModule({
      fileName: fixture.component.fileName,
      queryShapes: fixture.component.queryShapes,
      registryFacts: fixture.component.registryFacts,
      source: fixture.component.source,
    });

    expect(compiled.diagnostics).toEqual([]);
    expect(
      compiled.componentGraphFacts.map((fact) => ({
        fragments: [...(fact.fragments ?? [])],
        name: fact.name,
        queries: [...(fact.queries ?? [])].sort(),
      })),
    ).toEqual(fixture.graph.componentGraphFacts);
    expect(
      compiled.queryUpdatePlans.map((plan) => ({
        paths: [...plan.paths].sort(),
        query: plan.query,
        templateStamps: (plan.templateStamps ?? []).map((stamp) => stamp.selector),
      })),
    ).toEqual([
      {
        paths: ['cart.count', 'cart.items'],
        query: 'cart',
        templateStamps: ['[data-bind-list="cart.items"]'],
      },
      {
        paths: ['product.stock'],
        query: 'product',
        templateStamps: [],
      },
    ]);

    const clientExports = executeGeneratedClientArtifact(compiled.files, {
      runtime: {
        applyCompiledQueryUpdatePlan,
        derive,
        kovoEscapeHtml,
        kovoStyleProperty,
        runQueryUpdatePlan,
      },
    });
    const queryPlans = clientExports[fixture.component.queryPlanExportName] as Record<
      string,
      (root: unknown, value: unknown, context?: unknown) => unknown
    >;
    expect(Object.keys(queryPlans).sort()).toEqual(['cart', 'product']);
    const planRoot = oracleRootFixture(fixture.component.fragmentTarget);
    queryPlans.cart(planRoot, fixture.runtime.cartValue, { queryStore: createQueryStore() });
    expect((planRoot.elements[2] as GeneratedFixtureTemplateStampHost).items).toMatchObject(
      fixture.runtime.expectedTemplateItems,
    );

    const modularRoot = oracleRootFixture(fixture.component.fragmentTarget);
    const modularStore = createQueryStore();
    const modularApplied = applyMutationResponseChunksToRuntime(
      readMutationResponseBodyChunks(fixture.runtime.body),
      {
        queryPlans,
        root: modularRoot,
        store: modularStore,
      },
    );

    expect(modularApplied.appliedFragments).toEqual(fixture.runtime.expectedAppliedFragments);
    expect(modularApplied.queries).toEqual(['cart', 'product']);
    expect(modularStore.get('cart')).toEqual(fixture.runtime.cartValue);
    expect(modularStore.get('product')).toEqual(fixture.runtime.productValue);
    expect(modularRoot.bindings[0]?.textContent).toBe('2');
    expect(modularRoot.elements[0]?.getAttribute('hidden')).toBeNull();
    expect(modularRoot.elements[1]?.getAttribute('aria-label')).toBe('7');
    expect(modularRoot.targets.get(fixture.component.fragmentTarget)?.html).toBe(
      fixture.runtime.fragmentHtml,
    );

    const inlineRoot = oracleRootFixture(fixture.component.fragmentTarget);
    const inlineStore = createQueryStore();
    const inlineChunks = readInlineMutationResponseBodyChunks(fixture.runtime.body);
    const decodedInlineQueries = inlineChunks.queries.flatMap((chunk) => {
      const query = readQueryElementChunk(chunk);
      return query ? [query] : [];
    });
    const inlineAppliedQueries = applyQueryChunksToRuntime(inlineStore, decodedInlineQueries, {
      queryPlans,
      root: inlineRoot,
    });
    const globalRecord = globalThis as unknown as { document?: unknown };
    const originalDocument = globalRecord.document;
    globalRecord.document = {
      createElement(name: string) {
        if (name !== 'template') throw new Error(`unexpected inline test element: ${name}`);
        const template = {
          content: { childNodes: [] as unknown[], children: [] as unknown[] },
          set innerHTML(value: string) {
            const element = {
              attributes: [] as Array<{ name: string; value: string }>,
              outerHTML: value,
              querySelectorAll() {
                return [];
              },
              toString() {
                return value;
              },
            };
            this.content.childNodes = [element];
            this.content.children = [element];
          },
        };
        return template;
      },
    };
    const inlineAppliedFragments = applyInlineMutationResponseChunks(inlineChunks, {
      findFragmentTarget(target) {
        return inlineRoot.findFragmentTarget(target);
      },
    });

    try {
      expect(inlineAppliedQueries).toEqual(['cart', 'product']);
      expect(inlineAppliedFragments).toEqual(fixture.runtime.expectedAppliedFragments);
      expect(inlineStore.get('cart')).toEqual(modularStore.get('cart'));
      expect(inlineStore.get('product')).toEqual(modularStore.get('product'));
      expect(inlineRoot.bindings[0]?.textContent).toBe('2');
      expect(inlineRoot.elements[0]?.getAttribute('hidden')).toBeNull();
      expect(inlineRoot.elements[1]?.getAttribute('aria-label')).toBe('7');
      expect(inlineRoot.targets.get(fixture.component.fragmentTarget)?.html).toBe(
        fixture.runtime.fragmentHtml,
      );
    } finally {
      globalRecord.document = originalDocument;
    }

    const verifier = createDbVerifier(fixture.graph.touchGraph as never, {
      domainByTable: fixture.graph.domainByTable,
      keyByTable: fixture.graph.keyByTable,
    });
    const verifiedDb = verifier.wrap(createVerificationFakeDb());
    verifiedDb.write('cart_items', { cartId: 'c1', productId: 'p1', qty: 1 });
    verifiedDb.sql("update products set stock = 6 where id = 'p1'");
    verifiedDb.sql("select * from products where id = 'p1'");

    expect(() => verifier.assertCovered('addToCart')).not.toThrow();
    expect(() => verifier.assertReadsCovered(['product'])).not.toThrow();
    expect(verifier.observed.length).toBeGreaterThanOrEqual(3);
  });
});

function oracleRootFixture(fragmentTarget: string): GeneratedFixtureMorphRoot {
  const root = new GeneratedFixtureMorphRoot();
  root.targets.set(fragmentTarget, {
    html: '',
    append(...nodes: unknown[]) {
      this.html += nodes.join('');
    },
    appendHtml(html: string) {
      this.html += html;
    },
    insertAdjacentHTML(_position: string, html: string) {
      this.html += html;
    },
    replaceWithHtml(html: string) {
      this.html = html;
    },
  } as unknown as GeneratedFixtureMorphTarget);
  root.bindings.push(
    new GeneratedFixtureElement({ 'data-bind': 'cart.count' }, { textContent: '0' }),
  );
  root.elements.push(
    new GeneratedFixtureElement({ 'data-bind:hidden': 'cart.empty', hidden: 'true' }),
    new GeneratedFixtureElement({
      'data-bind:aria-label': 'product.stock',
      'aria-label': 'stale',
    }),
    new GeneratedFixtureTemplateStampHost({ 'data-bind-list': 'cart.items' }),
  );
  return root;
}
