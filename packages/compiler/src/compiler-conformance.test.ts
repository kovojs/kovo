import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  applyCompiledQueryUpdatePlan,
  derive,
  kovoEscapeHtml,
  kovoStyleProperty,
} from '@kovojs/runtime/generated';
import { describe, expect, it } from 'vitest';

import {
  assertFixpoint,
  assertRenderEquivalence,
  compileComponentModule,
  compileRouteModule,
} from './index.js';
import type { CompilerDiagnostic } from './diagnostics.js';
import { mutationInputFactsFromSource } from './internal.js';
import type { CompileResult, EmittedFile } from './types.js';

const commerceComponentNames = ['cart-badge', 'order-history', 'product-grid'] as const;

interface CorpusArtifactFact {
  clientExports: readonly string[];
  componentGraphFacts: readonly unknown[];
  cssAssetCount: number;
  diagnostics: readonly string[];
  fileKinds: readonly string[];
  fixpoint: true;
  loweredSourceFacts: {
    hasCompilerIrHeader: boolean;
    hasComponentStamp: boolean;
    hasQueryStamp: boolean;
  };
  moduleFacts: {
    clientHasNoHandlerFallback: boolean;
    clientHasQueryPlans: boolean;
    registryHasRoutes: boolean;
    serverHasRenderSource: boolean;
  };
  name: string;
  registryFacts: {
    hasComponentStylesheet: boolean;
    hasFragmentTargets: boolean;
    hasQueryUpdatePlans: boolean;
    hasRouteRegistry: boolean;
  };
  renderEquivalence: readonly boolean[];
}

interface RuntimeUpdateFact {
  applied: {
    bindings: readonly string[];
    derives: readonly string[];
    stamps: readonly string[];
    templateStamps: readonly string[];
  };
  buttonHidden: string | null;
  countText: string | null;
  templateHtml: string;
  templateKeys: readonly string[];
}

describe('compiler conformance corpus', () => {
  it('checks authored TSX through lowered IR, emitted modules, registry facts, and app graph facts', () => {
    // SPEC §5.2: app-authored TSX is the input; lowered IR and generated modules are artifacts.
    const corpus = [
      referenceShellFixture(),
      ...commerceComponentNames.map((name) => commerceComponentFixture(name)),
      focusedGeneratedFixture(),
    ];

    expect(corpus.map(corpusArtifactFact)).toMatchInlineSnapshot(`
      [
        {
          "clientExports": [],
          "componentGraphFacts": [
            {
              "domName": "reference-shell",
              "exportName": "ReferenceShell",
              "fragments": [
                "components/reference-shell/reference-shell",
              ],
              "name": "components/reference-shell/reference-shell",
              "queries": [
                "account",
              ],
            },
          ],
          "cssAssetCount": 0,
          "diagnostics": [],
          "fileKinds": [
            "server",
            "client",
            "registry",
          ],
          "fixpoint": true,
          "loweredSourceFacts": {
            "hasCompilerIrHeader": true,
            "hasComponentStamp": true,
            "hasQueryStamp": true,
          },
          "moduleFacts": {
            "clientHasNoHandlerFallback": false,
            "clientHasQueryPlans": true,
            "registryHasRoutes": true,
            "serverHasRenderSource": true,
          },
          "name": "components/reference-shell/reference-shell",
          "registryFacts": {
            "hasComponentStylesheet": true,
            "hasFragmentTargets": true,
            "hasQueryUpdatePlans": true,
            "hasRouteRegistry": true,
          },
          "renderEquivalence": [
            true,
          ],
        },
        {
          "clientExports": [],
          "componentGraphFacts": [
            {
              "domName": "cart-badge",
              "exportName": "CartBadge",
              "fragments": [
                "components/cart-badge/cart-badge",
              ],
              "name": "components/cart-badge/cart-badge",
              "queries": [
                "cart",
              ],
              "styleRules": [
                {
                  "className": "kv-cart-badge-align-1n0np7",
                  "source": "examples/commerce/src/components/cart-badge.tsx#badge",
                  "styleRef": "cartBadgeStyles.badge",
                },
                {
                  "className": "kv-cart-badge-bg-z64ku4",
                  "source": "examples/commerce/src/components/cart-badge.tsx#badge",
                  "styleRef": "cartBadgeStyles.badge",
                },
                {
                  "className": "kv-cart-badge-bd-5rajyo",
                  "source": "examples/commerce/src/components/cart-badge.tsx#badge",
                  "styleRef": "cartBadgeStyles.badge",
                },
                {
                  "className": "kv-cart-badge-bd-zehgw2",
                  "source": "examples/commerce/src/components/cart-badge.tsx#badge",
                  "styleRef": "cartBadgeStyles.badge",
                },
                {
                  "className": "kv-cart-badge-bd-169px8",
                  "source": "examples/commerce/src/components/cart-badge.tsx#badge",
                  "styleRef": "cartBadgeStyles.badge",
                },
                {
                  "className": "kv-cart-badge-bd-19c8ne",
                  "source": "examples/commerce/src/components/cart-badge.tsx#badge",
                  "styleRef": "cartBadgeStyles.badge",
                },
                {
                  "className": "kv-cart-badge-fg-ulvh0s",
                  "source": "examples/commerce/src/components/cart-badge.tsx#badge",
                  "styleRef": "cartBadgeStyles.badge",
                },
                {
                  "className": "kv-cart-badge-d-rjc9a1",
                  "source": "examples/commerce/src/components/cart-badge.tsx#badge",
                  "styleRef": "cartBadgeStyles.badge",
                },
                {
                  "className": "kv-cart-badge-font-wfjt8u",
                  "source": "examples/commerce/src/components/cart-badge.tsx#badge",
                  "styleRef": "cartBadgeStyles.badge",
                },
                {
                  "className": "kv-cart-badge-font-69d2ez",
                  "source": "examples/commerce/src/components/cart-badge.tsx#badge",
                  "styleRef": "cartBadgeStyles.badge",
                },
                {
                  "className": "kv-cart-badge-gap-th4gxo",
                  "source": "examples/commerce/src/components/cart-badge.tsx#badge",
                  "styleRef": "cartBadgeStyles.badge",
                },
                {
                  "className": "kv-cart-badge-pad-82ra0h",
                  "source": "examples/commerce/src/components/cart-badge.tsx#badge",
                  "styleRef": "cartBadgeStyles.badge",
                },
                {
                  "className": "kv-cart-badge-pad-1xb6c1",
                  "source": "examples/commerce/src/components/cart-badge.tsx#badge",
                  "styleRef": "cartBadgeStyles.badge",
                },
                {
                  "className": "kv-cart-badge-align-1n0np7",
                  "source": "examples/commerce/src/components/cart-badge.tsx#badge",
                  "styleRef": "cartBadgeStyles.count",
                },
                {
                  "className": "kv-cart-badge-bg-73eir6",
                  "source": "examples/commerce/src/components/cart-badge.tsx#count",
                  "styleRef": "cartBadgeStyles.count",
                },
                {
                  "className": "kv-cart-badge-bd-1ans0m",
                  "source": "examples/commerce/src/components/cart-badge.tsx#count",
                  "styleRef": "cartBadgeStyles.count",
                },
                {
                  "className": "kv-cart-badge-fg-1d7izn",
                  "source": "examples/commerce/src/components/cart-badge.tsx#count",
                  "styleRef": "cartBadgeStyles.count",
                },
                {
                  "className": "kv-cart-badge-d-rjc9a1",
                  "source": "examples/commerce/src/components/cart-badge.tsx#badge",
                  "styleRef": "cartBadgeStyles.count",
                },
                {
                  "className": "kv-cart-badge-font-hgn7l4",
                  "source": "examples/commerce/src/components/cart-badge.tsx#count",
                  "styleRef": "cartBadgeStyles.count",
                },
                {
                  "className": "kv-cart-badge-font-8pgwt0",
                  "source": "examples/commerce/src/components/cart-badge.tsx#count",
                  "styleRef": "cartBadgeStyles.count",
                },
                {
                  "className": "kv-cart-badge-font-o2m1ue",
                  "source": "examples/commerce/src/components/cart-badge.tsx#count",
                  "styleRef": "cartBadgeStyles.count",
                },
                {
                  "className": "kv-cart-badge-h-1wd2oy",
                  "source": "examples/commerce/src/components/cart-badge.tsx#count",
                  "styleRef": "cartBadgeStyles.count",
                },
                {
                  "className": "kv-cart-badge-justify-olqh3l",
                  "source": "examples/commerce/src/components/cart-badge.tsx#count",
                  "styleRef": "cartBadgeStyles.count",
                },
                {
                  "className": "kv-cart-badge-min-6nuqyp",
                  "source": "examples/commerce/src/components/cart-badge.tsx#count",
                  "styleRef": "cartBadgeStyles.count",
                },
                {
                  "className": "kv-cart-badge-pad-88ob6b",
                  "source": "examples/commerce/src/components/cart-badge.tsx#count",
                  "styleRef": "cartBadgeStyles.count",
                },
              ],
            },
          ],
          "cssAssetCount": 1,
          "diagnostics": [],
          "fileKinds": [
            "server",
            "client",
            "css",
            "registry",
          ],
          "fixpoint": true,
          "loweredSourceFacts": {
            "hasCompilerIrHeader": true,
            "hasComponentStamp": false,
            "hasQueryStamp": true,
          },
          "moduleFacts": {
            "clientHasNoHandlerFallback": false,
            "clientHasQueryPlans": true,
            "registryHasRoutes": false,
            "serverHasRenderSource": true,
          },
          "name": "components/cart-badge/cart-badge",
          "registryFacts": {
            "hasComponentStylesheet": true,
            "hasFragmentTargets": true,
            "hasQueryUpdatePlans": true,
            "hasRouteRegistry": true,
          },
          "renderEquivalence": [
            true,
          ],
        },
        {
          "clientExports": [],
          "componentGraphFacts": [
            {
              "domName": "order-history",
              "exportName": "OrderHistory",
              "fragments": [
                "components/order-history/order-history",
              ],
              "name": "components/order-history/order-history",
              "queries": [
                "orderHistory",
              ],
              "styleRules": [
                {
                  "className": "kv-order-history-align-1vxg5e",
                  "source": "examples/commerce/src/components/order-history.tsx#item",
                  "styleRef": "orderHistoryStyles.item",
                },
                {
                  "className": "kv-order-history-bg-18m7ru",
                  "source": "examples/commerce/src/components/order-history.tsx#item",
                  "styleRef": "orderHistoryStyles.item",
                },
                {
                  "className": "kv-order-history-bd-op7bl2",
                  "source": "examples/commerce/src/components/order-history.tsx#item",
                  "styleRef": "orderHistoryStyles.item",
                },
                {
                  "className": "kv-order-history-bd-iktxcg",
                  "source": "examples/commerce/src/components/order-history.tsx#item",
                  "styleRef": "orderHistoryStyles.item",
                },
                {
                  "className": "kv-order-history-bd-4bkxwb",
                  "source": "examples/commerce/src/components/order-history.tsx#item",
                  "styleRef": "orderHistoryStyles.item",
                },
                {
                  "className": "kv-order-history-bd-3lxn3i",
                  "source": "examples/commerce/src/components/order-history.tsx#item",
                  "styleRef": "orderHistoryStyles.item",
                },
                {
                  "className": "kv-order-history-d-10jo0b",
                  "source": "examples/commerce/src/components/order-history.tsx#item",
                  "styleRef": "orderHistoryStyles.item",
                },
                {
                  "className": "kv-order-history-justify-15wv6m",
                  "source": "examples/commerce/src/components/order-history.tsx#item",
                  "styleRef": "orderHistoryStyles.item",
                },
                {
                  "className": "kv-order-history-pad-1b45q7",
                  "source": "examples/commerce/src/components/order-history.tsx#item",
                  "styleRef": "orderHistoryStyles.item",
                },
                {
                  "className": "kv-order-history-pad-92euu",
                  "source": "examples/commerce/src/components/order-history.tsx#item",
                  "styleRef": "orderHistoryStyles.item",
                },
                {
                  "className": "kv-order-history-fg-2xog1x",
                  "source": "examples/commerce/src/components/order-history.tsx#mutedText",
                  "styleRef": "orderHistoryStyles.mutedText",
                },
                {
                  "className": "kv-order-history-font-1pgyx3",
                  "source": "examples/commerce/src/components/order-history.tsx#mutedText",
                  "styleRef": "orderHistoryStyles.mutedText",
                },
                {
                  "className": "kv-order-history-align-1vxg5e",
                  "source": "examples/commerce/src/components/order-history.tsx#item",
                  "styleRef": "orderHistoryStyles.row",
                },
                {
                  "className": "kv-order-history-d-10jo0b",
                  "source": "examples/commerce/src/components/order-history.tsx#item",
                  "styleRef": "orderHistoryStyles.row",
                },
                {
                  "className": "kv-order-history-gap-vivniy",
                  "source": "examples/commerce/src/components/order-history.tsx#row",
                  "styleRef": "orderHistoryStyles.row",
                },
                {
                  "className": "kv-order-history-d-1x60gr",
                  "source": "examples/commerce/src/components/order-history.tsx#stack",
                  "styleRef": "orderHistoryStyles.stack",
                },
                {
                  "className": "kv-order-history-gap-vivniy",
                  "source": "examples/commerce/src/components/order-history.tsx#row",
                  "styleRef": "orderHistoryStyles.stack",
                },
                {
                  "className": "kv-order-history-d-1x60gr",
                  "source": "examples/commerce/src/components/order-history.tsx#stack",
                  "styleRef": "orderHistoryStyles.stackSm",
                },
                {
                  "className": "kv-order-history-gap-1s2lxs",
                  "source": "examples/commerce/src/components/order-history.tsx#stackSm",
                  "styleRef": "orderHistoryStyles.stackSm",
                },
                {
                  "className": "kv-order-history-font-4v1il5",
                  "source": "examples/commerce/src/components/order-history.tsx#tabularStrong",
                  "styleRef": "orderHistoryStyles.tabularStrong",
                },
                {
                  "className": "kv-order-history-font-1bl9ee",
                  "source": "examples/commerce/src/components/order-history.tsx#tabularStrong",
                  "styleRef": "orderHistoryStyles.tabularStrong",
                },
                {
                  "className": "kv-order-history-fg-1h3b6s",
                  "source": "examples/commerce/src/components/order-history.tsx#title",
                  "styleRef": "orderHistoryStyles.title",
                },
                {
                  "className": "kv-order-history-font-1bl9ee",
                  "source": "examples/commerce/src/components/order-history.tsx#tabularStrong",
                  "styleRef": "orderHistoryStyles.title",
                },
                {
                  "className": "kv-order-history-letter-1yuj1e",
                  "source": "examples/commerce/src/components/order-history.tsx#title",
                  "styleRef": "orderHistoryStyles.title",
                },
                {
                  "className": "kv-order-history-m-1m87zi",
                  "source": "examples/commerce/src/components/order-history.tsx#title",
                  "styleRef": "orderHistoryStyles.title",
                },
              ],
            },
          ],
          "cssAssetCount": 1,
          "diagnostics": [],
          "fileKinds": [
            "server",
            "client",
            "css",
            "registry",
          ],
          "fixpoint": true,
          "loweredSourceFacts": {
            "hasCompilerIrHeader": true,
            "hasComponentStamp": false,
            "hasQueryStamp": false,
          },
          "moduleFacts": {
            "clientHasNoHandlerFallback": true,
            "clientHasQueryPlans": false,
            "registryHasRoutes": false,
            "serverHasRenderSource": true,
          },
          "name": "components/order-history/order-history",
          "registryFacts": {
            "hasComponentStylesheet": true,
            "hasFragmentTargets": true,
            "hasQueryUpdatePlans": true,
            "hasRouteRegistry": true,
          },
          "renderEquivalence": [
            true,
          ],
        },
        {
          "clientExports": [],
          "componentGraphFacts": [
            {
              "domName": "product-grid",
              "exportName": "ProductGrid",
              "fragments": [
                "components/product-grid/product-grid",
              ],
              "mutationForms": [
                {
                  "fieldErrors": [
                    {
                      "id": "{\`add-to-cart-quantity-error-\${item.id}\`}",
                      "name": "quantity",
                    },
                  ],
                  "fields": [
                    "productId",
                    "quantity",
                  ],
                  "formErrors": [
                    {
                      "code": "OUT_OF_STOCK",
                    },
                  ],
                  "mutation": "cart/add",
                  "slot": "addToCart",
                },
              ],
              "name": "components/product-grid/product-grid",
              "queries": [
                "productGrid",
              ],
              "styleRules": [
                {
                  "className": "kv-product-grid-fg-1a8f0w",
                  "source": "examples/commerce/src/components/product-grid.tsx#errorText",
                  "styleRef": "productGridStyles.errorText",
                },
                {
                  "className": "kv-product-grid-font-1dmql4",
                  "source": "examples/commerce/src/components/product-grid.tsx#errorText",
                  "styleRef": "productGridStyles.errorText",
                },
                {
                  "className": "kv-product-grid-bg-fqfzhr",
                  "source": "examples/commerce/src/components/product-grid.tsx#field",
                  "styleRef": "productGridStyles.field",
                },
                {
                  "className": "kv-product-grid-bd-17yl2y",
                  "source": "examples/commerce/src/components/product-grid.tsx#field",
                  "styleRef": "productGridStyles.field",
                },
                {
                  "className": "kv-product-grid-bd-cxmz9t",
                  "source": "examples/commerce/src/components/product-grid.tsx#field",
                  "styleRef": "productGridStyles.field",
                },
                {
                  "className": "kv-product-grid-bd-20shz8",
                  "source": "examples/commerce/src/components/product-grid.tsx#field",
                  "styleRef": "productGridStyles.field",
                },
                {
                  "className": "kv-product-grid-bd-ycquvh",
                  "source": "examples/commerce/src/components/product-grid.tsx#field",
                  "styleRef": "productGridStyles.field",
                },
                {
                  "className": "kv-product-grid-box-1e75m0",
                  "source": "examples/commerce/src/components/product-grid.tsx#field",
                  "styleRef": "productGridStyles.field",
                },
                {
                  "className": "kv-product-grid-fg-gtinz5",
                  "source": "examples/commerce/src/components/product-grid.tsx#field",
                  "styleRef": "productGridStyles.field",
                },
                {
                  "className": "kv-product-grid-pad-583j80",
                  "source": "examples/commerce/src/components/product-grid.tsx#field",
                  "styleRef": "productGridStyles.field",
                },
                {
                  "className": "kv-product-grid-pad-66mtq9",
                  "source": "examples/commerce/src/components/product-grid.tsx#field",
                  "styleRef": "productGridStyles.field",
                },
                {
                  "className": "kv-product-grid-fg-emqj71",
                  "source": "examples/commerce/src/components/product-grid.tsx#formLabel",
                  "styleRef": "productGridStyles.formLabel",
                },
                {
                  "className": "kv-product-grid-d-zbwzwb",
                  "source": "examples/commerce/src/components/product-grid.tsx#formLabel",
                  "styleRef": "productGridStyles.formLabel",
                },
                {
                  "className": "kv-product-grid-font-1b3epb",
                  "source": "examples/commerce/src/components/product-grid.tsx#formLabel",
                  "styleRef": "productGridStyles.formLabel",
                },
                {
                  "className": "kv-product-grid-font-1riwsq",
                  "source": "examples/commerce/src/components/product-grid.tsx#formLabel",
                  "styleRef": "productGridStyles.formLabel",
                },
                {
                  "className": "kv-product-grid-gap-18yvcf",
                  "source": "examples/commerce/src/components/product-grid.tsx#formLabel",
                  "styleRef": "productGridStyles.formLabel",
                },
                {
                  "className": "kv-product-grid-fg-p4cbfq",
                  "source": "examples/commerce/src/components/product-grid.tsx#link",
                  "styleRef": "productGridStyles.link",
                },
                {
                  "className": "kv-product-grid-font-1dmql4",
                  "source": "examples/commerce/src/components/product-grid.tsx#errorText",
                  "styleRef": "productGridStyles.link",
                },
                {
                  "className": "kv-product-grid-font-1riwsq",
                  "source": "examples/commerce/src/components/product-grid.tsx#formLabel",
                  "styleRef": "productGridStyles.link",
                },
                {
                  "className": "kv-product-grid-text-5zwurx",
                  "source": "examples/commerce/src/components/product-grid.tsx#link",
                  "styleRef": "productGridStyles.link",
                },
                {
                  "className": "kv-product-grid-bg-1ovdb1",
                  "source": "examples/commerce/src/components/product-grid.tsx#panelError",
                  "styleRef": "productGridStyles.panelError",
                },
                {
                  "className": "kv-product-grid-bd-7kjy5v",
                  "source": "examples/commerce/src/components/product-grid.tsx#panelError",
                  "styleRef": "productGridStyles.panelError",
                },
                {
                  "className": "kv-product-grid-bd-cxmz9t",
                  "source": "examples/commerce/src/components/product-grid.tsx#field",
                  "styleRef": "productGridStyles.panelError",
                },
                {
                  "className": "kv-product-grid-bd-20shz8",
                  "source": "examples/commerce/src/components/product-grid.tsx#field",
                  "styleRef": "productGridStyles.panelError",
                },
                {
                  "className": "kv-product-grid-bd-ycquvh",
                  "source": "examples/commerce/src/components/product-grid.tsx#field",
                  "styleRef": "productGridStyles.panelError",
                },
                {
                  "className": "kv-product-grid-fg-1jhvxd",
                  "source": "examples/commerce/src/components/product-grid.tsx#panelError",
                  "styleRef": "productGridStyles.panelError",
                },
                {
                  "className": "kv-product-grid-font-1dmql4",
                  "source": "examples/commerce/src/components/product-grid.tsx#errorText",
                  "styleRef": "productGridStyles.panelError",
                },
                {
                  "className": "kv-product-grid-pad-zcqjwv",
                  "source": "examples/commerce/src/components/product-grid.tsx#panelError",
                  "styleRef": "productGridStyles.panelError",
                },
                {
                  "className": "kv-product-grid-bg-msu64p",
                  "source": "examples/commerce/src/components/product-grid.tsx#productEmoji",
                  "styleRef": "productGridStyles.productEmoji",
                },
                {
                  "className": "kv-product-grid-bd-cxmz9t",
                  "source": "examples/commerce/src/components/product-grid.tsx#field",
                  "styleRef": "productGridStyles.productEmoji",
                },
                {
                  "className": "kv-product-grid-d-zbwzwb",
                  "source": "examples/commerce/src/components/product-grid.tsx#formLabel",
                  "styleRef": "productGridStyles.productEmoji",
                },
                {
                  "className": "kv-product-grid-font-14cref",
                  "source": "examples/commerce/src/components/product-grid.tsx#productEmoji",
                  "styleRef": "productGridStyles.productEmoji",
                },
                {
                  "className": "kv-product-grid-h-1emdn3",
                  "source": "examples/commerce/src/components/product-grid.tsx#productEmoji",
                  "styleRef": "productGridStyles.productEmoji",
                },
                {
                  "className": "kv-product-grid-place-1lop9p",
                  "source": "examples/commerce/src/components/product-grid.tsx#productEmoji",
                  "styleRef": "productGridStyles.productEmoji",
                },
                {
                  "className": "kv-product-grid-w-bygggi",
                  "source": "examples/commerce/src/components/product-grid.tsx#productEmoji",
                  "styleRef": "productGridStyles.productEmoji",
                },
                {
                  "className": "kv-product-grid-align-1gebhx",
                  "source": "examples/commerce/src/components/product-grid.tsx#productForm",
                  "styleRef": "productGridStyles.productForm",
                },
                {
                  "className": "kv-product-grid-d-1upqo3",
                  "source": "examples/commerce/src/components/product-grid.tsx#productForm",
                  "styleRef": "productGridStyles.productForm",
                },
                {
                  "className": "kv-product-grid-flex-1yw3ta",
                  "source": "examples/commerce/src/components/product-grid.tsx#productForm",
                  "styleRef": "productGridStyles.productForm",
                },
                {
                  "className": "kv-product-grid-gap-1og9b5",
                  "source": "examples/commerce/src/components/product-grid.tsx#productForm",
                  "styleRef": "productGridStyles.productForm",
                },
                {
                  "className": "kv-product-grid-align-kr7kq4",
                  "source": "examples/commerce/src/components/product-grid.tsx#row",
                  "styleRef": "productGridStyles.row",
                },
                {
                  "className": "kv-product-grid-d-1upqo3",
                  "source": "examples/commerce/src/components/product-grid.tsx#productForm",
                  "styleRef": "productGridStyles.row",
                },
                {
                  "className": "kv-product-grid-gap-vivniy",
                  "source": "examples/commerce/src/components/product-grid.tsx#row",
                  "styleRef": "productGridStyles.row",
                },
                {
                  "className": "kv-product-grid-align-kr7kq4",
                  "source": "examples/commerce/src/components/product-grid.tsx#row",
                  "styleRef": "productGridStyles.rowBetween",
                },
                {
                  "className": "kv-product-grid-d-1upqo3",
                  "source": "examples/commerce/src/components/product-grid.tsx#productForm",
                  "styleRef": "productGridStyles.rowBetween",
                },
                {
                  "className": "kv-product-grid-justify-m1htsu",
                  "source": "examples/commerce/src/components/product-grid.tsx#rowBetween",
                  "styleRef": "productGridStyles.rowBetween",
                },
                {
                  "className": "kv-product-grid-d-zbwzwb",
                  "source": "examples/commerce/src/components/product-grid.tsx#formLabel",
                  "styleRef": "productGridStyles.stack",
                },
                {
                  "className": "kv-product-grid-gap-vivniy",
                  "source": "examples/commerce/src/components/product-grid.tsx#row",
                  "styleRef": "productGridStyles.stack",
                },
                {
                  "className": "kv-product-grid-d-zbwzwb",
                  "source": "examples/commerce/src/components/product-grid.tsx#formLabel",
                  "styleRef": "productGridStyles.stackSm",
                },
                {
                  "className": "kv-product-grid-gap-18yvcf",
                  "source": "examples/commerce/src/components/product-grid.tsx#formLabel",
                  "styleRef": "productGridStyles.stackSm",
                },
                {
                  "className": "kv-product-grid-font-4v1il5",
                  "source": "examples/commerce/src/components/product-grid.tsx#tabularStrong",
                  "styleRef": "productGridStyles.tabularStrong",
                },
                {
                  "className": "kv-product-grid-font-1bl9ee",
                  "source": "examples/commerce/src/components/product-grid.tsx#tabularStrong",
                  "styleRef": "productGridStyles.tabularStrong",
                },
                {
                  "className": "kv-product-grid-fg-gtinz5",
                  "source": "examples/commerce/src/components/product-grid.tsx#field",
                  "styleRef": "productGridStyles.title",
                },
                {
                  "className": "kv-product-grid-font-1bl9ee",
                  "source": "examples/commerce/src/components/product-grid.tsx#tabularStrong",
                  "styleRef": "productGridStyles.title",
                },
                {
                  "className": "kv-product-grid-letter-1yuj1e",
                  "source": "examples/commerce/src/components/product-grid.tsx#title",
                  "styleRef": "productGridStyles.title",
                },
                {
                  "className": "kv-product-grid-m-1m87zi",
                  "source": "examples/commerce/src/components/product-grid.tsx#title",
                  "styleRef": "productGridStyles.title",
                },
              ],
            },
          ],
          "cssAssetCount": 1,
          "diagnostics": [],
          "fileKinds": [
            "server",
            "client",
            "css",
            "registry",
          ],
          "fixpoint": true,
          "loweredSourceFacts": {
            "hasCompilerIrHeader": true,
            "hasComponentStamp": true,
            "hasQueryStamp": true,
          },
          "moduleFacts": {
            "clientHasNoHandlerFallback": true,
            "clientHasQueryPlans": false,
            "registryHasRoutes": false,
            "serverHasRenderSource": true,
          },
          "name": "components/product-grid/product-grid",
          "registryFacts": {
            "hasComponentStylesheet": true,
            "hasFragmentTargets": true,
            "hasQueryUpdatePlans": true,
            "hasRouteRegistry": true,
          },
          "renderEquivalence": [
            true,
          ],
        },
        {
          "clientExports": [],
          "componentGraphFacts": [
            {
              "domName": "cart-badge",
              "exportName": "CartBadge",
              "fragments": [
                "conformance/generated/cart-badge/cart-badge",
              ],
              "name": "conformance/generated/cart-badge/cart-badge",
              "queries": [
                "cart",
              ],
            },
          ],
          "cssAssetCount": 0,
          "diagnostics": [],
          "fileKinds": [
            "server",
            "client",
            "registry",
          ],
          "fixpoint": true,
          "loweredSourceFacts": {
            "hasCompilerIrHeader": true,
            "hasComponentStamp": false,
            "hasQueryStamp": true,
          },
          "moduleFacts": {
            "clientHasNoHandlerFallback": false,
            "clientHasQueryPlans": true,
            "registryHasRoutes": true,
            "serverHasRenderSource": true,
          },
          "name": "conformance/generated/cart-badge/cart-badge",
          "registryFacts": {
            "hasComponentStylesheet": true,
            "hasFragmentTargets": true,
            "hasQueryUpdatePlans": true,
            "hasRouteRegistry": true,
          },
          "renderEquivalence": [
            true,
          ],
        },
      ]
    `);
  });

  it('executes generated query update plans against a browser-free DOM fixture', () => {
    // SPEC §4.8/§5.2: runtime updates are driven by compiler-owned data-bind and query-plan facts.
    const result = focusedGeneratedFixture();
    const clientExports = executeClientModule(fileByKind(result, 'client').source);
    const queryPlans = clientExports.CartBadge$queryUpdatePlans as {
      cart(root: FakeRoot, value: unknown): RuntimeUpdateFact['applied'];
    };
    const count = new FakeElement({ 'data-bind': 'cart.count' }, { textContent: '0' });
    const checkout = new FakeElement({
      'data-bind:hidden': 'cart.empty',
      hidden: '',
    });
    const derivedHidden = new FakeElement({
      'data-derive': 'cart.CartBadge$button_hidden_derive',
      hidden: '',
    });
    const template = new FakeTemplateHost({ 'data-bind-list': 'cart.items' });
    const root = new FakeRoot([count], [checkout, derivedHidden, template]);

    const applied = queryPlans.cart(root, {
      count: 2,
      empty: false,
      items: [
        { name: '<Mug>', productId: 'p1', qty: 1 },
        { name: 'Tea', productId: 'p2', qty: 3 },
      ],
    });

    expect({
      applied,
      buttonHidden: checkout.getAttribute('hidden'),
      countText: count.textContent,
      templateHtml: template.textContent ?? '',
      templateKeys: template.items.map((item) => item.key),
    } satisfies RuntimeUpdateFact).toMatchInlineSnapshot(`
      {
        "applied": {
          "bindings": [
            "cart.count",
            "cart.empty",
          ],
          "derives": [],
          "stamps": [
            "hidden",
          ],
          "templateStamps": [
            "[data-bind-list="cart.items"]",
          ],
        },
        "buttonHidden": "false",
        "countText": "2",
        "templateHtml": "<li><span data-bind=".qty">1</span> x <span data-bind=".name">&lt;Mug&gt;</span></li><li><span data-bind=".qty">3</span> x <span data-bind=".name">Tea</span></li>",
        "templateKeys": [
          "p1",
          "p2",
        ],
      }
    `);
  });

  it('snapshots compiler-owned diagnostic text gaps for high-value SPEC promises', () => {
    const diagnostics = compilerDiagnosticFixtures().flatMap(({ code, result }) =>
      diagnosticSnapshotFacts(result.diagnostics.filter((diagnostic) => diagnostic.code === code)),
    );

    expect(diagnostics).toMatchInlineSnapshot(`
      [
        {
          "code": "KV210",
          "help": "Would lower to: a generated Component$element_event handler export with a stable source-derived URL.
      Blocked reason: anonymous handler identity is less stable for generated artifacts, explanations, and agent repairs.
      Fixes: extract a named function in module scope or reference a named local handler from the JSX event.
      SPEC §5.2 requires readable, source-derived emitted names; this lint is advisory and has no suppression beyond accepting the generated fallback name.",
          "message": "Anonymous handler; name it for stable identity.",
          "severity": "lint",
        },
        {
          "code": "KV211",
          "help": "Blocked reason: on:load runs at parse time and adds eager JavaScript to the page budget.
      Fixes: use a user/event trigger instead, or attach an adjacent KV211 justification comment when parse-time execution is intentional.
      SPEC §4.7 keeps on:load grep-visible as the eager-JS escape hatch.
      Escape: an attached KV211 justification comment preserves the lint trail without blocking compilation.",
          "message": "on:load eager trigger requires a justification comment. on:load",
          "severity": "lint",
        },
        {
          "code": "KV212",
          "help": "Blocked reason: unknown on:* triggers cannot be mapped to the closed event/trigger vocabulary the loader understands.
      Fixes: use a DOM event name, use one of Kovo's declared execution triggers, or move the behavior into a component primitive that owns the attribute.
      SPEC §4.7 requires declared execution so generated artifacts remain auditable.",
          "message": "Unknown on:* event or execution trigger name. on:media",
          "severity": "lint",
        },
        {
          "code": "KV220",
          "help": "Would lower to: a route-checked href/action that participates in the typed route registry.
      Blocked reason: the literal target does not match any declared canonical route path.
      Fixes: use a typed route helper, declare the route, correct the literal path, or mark an intentional full-origin/external navigation with the external escape hatch.
      SPEC §6.4 and §9.5 require navigation targets to stay type-checked against the route table.
      Escape: external/full-origin URLs opt out because they are outside the app route graph.",
          "message": "Literal href or form action matches no declared route. /checkout",
          "severity": "error",
        },
        {
          "code": "KV221",
          "help": "Would lower to: light-DOM IDREF wiring whose target id exists in the same component scope.
      Blocked reason: the referenced id is absent, outside the validated scope, or hidden behind a different component boundary.
      Fixes: add the target id in this component scope, pass a generated id through props, or correct the IDREF attribute value.
      SPEC §4.5 and §6.4 require IDREFs such as commandfor, popovertarget, for, and aria-* to resolve at compile time.",
          "message": "IDREF references an id not present in component scope. missing",
          "severity": "error",
        },
        {
          "code": "KV222",
          "help": "Would lower to: the compiler-derived data-bind stamp for the typed JSX expression.
      Blocked reason: a hand-written stamp names a different path than the expression it wraps, so server render and client update semantics could drift.
      Fixes: remove the hand-written stamp and let the compiler derive it, or make the stamp path exactly match the typed expression.
      SPEC §4.8 treats typed expressions and binding stamps as one fact and rejects drift.",
          "message": "Hand-written binding stamp disagrees with the typed expression it wraps. data-bind="cart.total" wraps {cart.count}",
          "severity": "error",
        },
        {
          "code": "KV223",
          "help": "Would lower to: the same data-bind stamp the author already wrote by hand.
      Blocked reason: the stamp is redundant in app-authored TSX because the compiler can derive it from the typed expression.
      Fixes: remove the hand-written data-bind stamp and keep the typed JSX expression as the source of truth.
      SPEC §4.8 permits residual stamps for emitted IR fixpoint validation, but app TSX should not hand-author derivable stamps.
      Escape: emitted compiler artifacts may retain residual stamps for fixpoint checks; app source should use TSX sugar.",
          "message": "Redundant hand-written binding stamp in sugar; the compiler derives it. data-bind="cart.count" wraps {cart.count}",
          "severity": "lint",
        },
        {
          "code": "KV224",
          "help": "Blocked reason: duplicate static ids make IDREF proofs ambiguous, and static ids inside repeatable stamps can produce multiple elements with the same id.
      Fixes: generate ids from props/kovo-key, move the id outside the repeatable subtree, or pass a unique id down to the component.
      SPEC §4.5 requires ids to be unique by construction so KV221 IDREF validation remains meaningful.",
          "message": "Static id is duplicated in component scope or appears inside a repeatable stamp. duplicate id="title"",
          "severity": "error",
        },
        {
          "code": "KV225",
          "help": "Would lower to: HTML whose parsed DOM preserves the authored JSX tree.
      Blocked reason: the HTML parser would re-parent or drop invalid children, changing morph identity and fragment targets after serving.
      Fixes: use content-model-valid wrapper elements, move table rows into table/section parents, or split paragraph/block content into valid siblings.
      SPEC §4.2 requires compiler-served HTML and parsed DOM shape to agree.",
          "message": "JSX nesting violates the HTML content model. <div> cannot appear inside <p>",
          "severity": "error",
        },
        {
          "code": "KV226",
          "help": "Would lower to: emitted IR stamps whose kovo-c and kovo-deps names resolve to known components and query instances.
      Blocked reason: residual compiler stamps reference a component or query that is not present in the module/registry facts.
      Fixes: recompile from TSX source, correct the generated stamp, or add the missing component/query fact to the compile graph.
      SPEC §5.2 allows lowered IR only as compiler output/fixpoint input, and fixpoint validation must reject stale names.",
          "message": "kovo-deps or kovo-c names an unknown query instance or component. kovo-c="unknown-component"",
          "severity": "error",
        },
        {
          "code": "KV226",
          "help": "Would lower to: emitted IR stamps whose kovo-c and kovo-deps names resolve to known components and query instances.
      Blocked reason: residual compiler stamps reference a component or query that is not present in the module/registry facts.
      Fixes: recompile from TSX source, correct the generated stamp, or add the missing component/query fact to the compile graph.
      SPEC §5.2 allows lowered IR only as compiler output/fixpoint input, and fixpoint validation must reject stale names.",
          "message": "kovo-deps or kovo-c names an unknown query instance or component. kovo-deps="missing"",
          "severity": "error",
        },
        {
          "code": "KV227",
          "help": "Blocked reason: the binding path crosses a nullable query segment without declaring empty-on-null behavior.
      Fixes: write the nullable traversal with ?., extract a named derive that handles null explicitly, or make the projection non-null in the query.
      SPEC §4.8 requires empty-on-null semantics to be explicit so the server renderer and loader cannot drift.",
          "message": "Binding path traverses a nullable segment without ?. product.details.name (segment: details)",
          "severity": "error",
        },
        {
          "code": "KV231",
          "help": "Would lower to: a single composed attribute set for primitive composition.
      Blocked reason: both primitive and author write an attribute whose merge rule is ambiguous or unsafe, such as IDREF, data-p-*, kovo-c, or kovo-state.
      Fixes: keep one writer, pass the value through the primitive API, or move the relationship/state ownership to one component.
      SPEC §4.6 defines primitive attribute merge rules and treats double-wired relationships as errors.",
          "message": "Unmergeable attribute conflict in primitive composition. commandfor",
          "severity": "error",
        },
        {
          "code": "KV232",
          "help": "Would lower to: author-visible override of a primitive-owned ARIA, role, or state attribute.
      Blocked reason: the override is allowed but can change accessibility semantics or be clobbered by runtime-updated primitive state.
      Fixes: prefer the primitive API, remove the override, or keep it intentionally and audit the generated merge explanation.
      SPEC §4.6 keeps this override as a lint-level escape hatch so author intent stays visible.
      Escape: compilation continues; the lint documents the override for review.",
          "message": "Author overrides a primitive-owned ARIA or state attribute. role",
          "severity": "lint",
        },
        {
          "code": "KV233",
          "help": "Would lower to: exactly one writer for each data-bind target slot.
      Blocked reason: multiple bindings target the same text/attribute slot, so the client loader cannot choose a single update source.
      Fixes: keep one binding, split values across distinct elements/attributes, or combine the values in a named derive before binding.
      SPEC §4.6 and §4.8 require binding slots to have a single writer.",
          "message": "Two writers target the same binding slot. data-bind",
          "severity": "error",
        },
        {
          "code": "KV234",
          "help": "Would lower to: package-scoped component names, CSS scopes, and behavior attributes using one effective prefix.
      Blocked reason: the prefix is missing, invalid, duplicated, or reserves kovo-* outside @kovojs/* packages.
      Fixes: assign a lowercase dash-terminated unique prefix, alias one package, or use kovo-* only for framework packages.
      SPEC §6.1.1 requires app-wide unique package component prefixes.
      SPEC §6.1.1 reserves the kovo-* prefix family for packages whose manifest name is in the @kovojs/* scope.
      SPEC §6.1.1 reserves the kovo-* attribute namespace for framework-owned attributes and future loader/compiler growth.
      Fix: choose a non-reserved prefix, or add an explicit app-side alias such as "acme-kovo-".",
          "message": "Package component prefix registration conflict or reservation violation. @acme/widgets cannot use reserved kovo-* package prefix "kovo-".",
          "severity": "error",
        },
        {
          "code": "KV301",
          "help": "Blocked reason: server/query facts stored in island-local state create a second client-owned copy of server truth.
      Fixes: keep the value in query data, derive UI-only state from client intent, or store only local presentation state.
      SPEC §4.1 keeps query data server-owned and local state private/client-owned.",
          "message": "Server fact stored in island-local state.",
          "severity": "lint",
        },
        {
          "code": "KV302",
          "help": "Would lower to: a data-bind path that the server renderer and loader can both read from the declared query/state shape.
      Blocked reason: the path is absent from the declared shape, so a server render or client update would read undefined.
      Fixes: correct the binding path, update the query projection/schema, or extract a named derive with declared inputs.
      SPEC §4.8 and §6.2 require bindings to type-check against query shapes.",
          "message": "data-bind path is not present in the declared query shape. cart.total",
          "severity": "error",
        },
        {
          "code": "KV303",
          "help": "Would lower to: a fragment target that can be re-rendered from declared query data plus stamped props.
      Blocked reason: the render input is outside those channels, so a fragment response could not reconstruct the subtree.
      Fixes: declare the value as query data, stamp it as a serializable prop, or move the dependency inside the fragment target.
      SPEC §4.5 requires fragment targets to be reconstructible from declared server inputs.",
          "message": "Fragment target render input is not declared as query data or stamped props. priceList",
          "severity": "error",
        },
        {
          "code": "KV304",
          "help": "Blocked reason: the query name collides with a reserved binding root such as state.
      Fixes: rename the query instance to an app-owned root and update its bindings.
      SPEC §4.8 reserves binding roots so query paths and island-local state paths stay unambiguous.",
          "message": "Reserved query name is not allowed. state",
          "severity": "error",
        },
        {
          "code": "KV320",
          "help": "Blocked reason: a fire-and-forget event payload is carrying data that overlaps server-owned query facts.
      Fixes: send only client intent, use an optimistic transform for query data, or route the change through a mutation/domain write.
      SPEC §6.4 keeps cross-island events for intent, not as a shadow transport for server facts.",
          "message": "Event payload overlaps query data; use a transform. product.unitPrice",
          "severity": "lint",
        },
        {
          "code": "KV330",
          "help": "Blocked reason: direct request/db access in a mutation handler bypasses the domain write surface and weakens touch-graph analysis.
      Fixes: move writes behind a domain() module, inject the domain operation into the handler, or use the typed transaction context only inside the domain layer.
      SPEC §11.4 and §14 require writes to flow through domains so invalidation and verifier diagnostics stay complete.",
          "message": "Direct db access in a mutation handler; route through domain.",
          "severity": "lint",
        },
      ]
    `);
  });

  it('checks Commerce component IR through the package §5.2 gate on demand', () => {
    const facts = commerceComponentNames.map((name) => {
      const authoredPath = `components/${name}.tsx`;
      const generatedPath = `generated/${name}.tsx`;
      const fileName = `examples/commerce/src/${authoredPath}`;
      const result = commerceComponentFixture(name);
      assertFixpoint(result);
      assertRenderEquivalence(result);

      const lowered = result.loweredSource ?? result.renderEquivalenceChecks?.[0]?.expected ?? '';
      const expectedGeneratedSource = [
        `// @kovojs-ir — lowered from ${fileName} by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with \`pnpm run emit-components\`.`,
        lowered,
      ].join('\n');

      return {
        diagnostics: result.diagnostics.map((diagnostic) => diagnostic.code),
        fileName,
        fixpointAsserted: true,
        generatedPath,
        generatedSourceRecreated: expectedGeneratedSource.includes(lowered),
        loweredRenderSourcePresent: lowered.length > 0,
        renderEquivalenceAsserted: true,
      };
    });

    expect(facts).toEqual([
      {
        diagnostics: [],
        fileName: 'examples/commerce/src/components/cart-badge.tsx',
        fixpointAsserted: true,
        generatedPath: 'generated/cart-badge.tsx',
        generatedSourceRecreated: true,
        loweredRenderSourcePresent: true,
        renderEquivalenceAsserted: true,
      },
      {
        diagnostics: [],
        fileName: 'examples/commerce/src/components/order-history.tsx',
        fixpointAsserted: true,
        generatedPath: 'generated/order-history.tsx',
        generatedSourceRecreated: true,
        loweredRenderSourcePresent: true,
        renderEquivalenceAsserted: true,
      },
      {
        diagnostics: [],
        fileName: 'examples/commerce/src/components/product-grid.tsx',
        fixpointAsserted: true,
        generatedPath: 'generated/product-grid.tsx',
        generatedSourceRecreated: true,
        loweredRenderSourcePresent: true,
        renderEquivalenceAsserted: true,
      },
    ]);
  });

  it('checks Commerce route IR through the package §5.2 gate on demand', () => {
    const routeResult = compileRouteModule({
      artifactFileName: 'examples/commerce/src/generated/app.kovo-route.tsx',
      componentImportRewrites: [
        { localName: 'CartBadge', specifier: './cart-badge.js' },
        { localName: 'OrderHistory', specifier: './order-history.js' },
        { localName: 'ProductGrid', specifier: './product-grid.js' },
      ],
      fileName: 'examples/commerce/src/app.tsx',
      source: readFileSync(
        new URL('../../../examples/commerce/src/app.tsx', import.meta.url),
        'utf8',
      ),
    });

    expect(routeResult.diagnostics).toEqual([]);
    expect(routeResult.files.map((file) => file.fileName)).toEqual([
      'examples/commerce/src/generated/app.kovo-route.tsx',
    ]);
    expect(routeResult.files[0]?.source).toContain('createApp');
    expect(routeResult.files[0]?.source).not.toContain('renderCommerceLoginForm');
  });

  it('checks Commerce generated registry augmentation through the package §6.3 gate', () => {
    const outDir = mkdtempSync(resolve(tmpdir(), 'kovo-commerce-touch-graph-'));
    try {
      execFileSync(process.execPath, ['scripts/emit-graph.mjs', '--out-dir', outDir], {
        cwd: new URL('../../../examples/commerce/', import.meta.url),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const generatedSource = readFileSync(resolve(outDir, 'touch-graph.ts'), 'utf8');

      expect(generatedSource).toContain("interface MutationRegistry {\n    'cart/add':");
      expect(generatedSource).toContain("typeof import('../domain.js').addToCart;");
      expect(generatedSource).toContain(
        'interface InvalidationSets extends CommerceInvalidationSets',
      );
    } finally {
      rmSync(outDir, { force: true, recursive: true });
    }
  });
});

function referenceShellFixture(): CompileResult {
  return compileComponentModule({
    fileName: 'examples/reference/src/components/reference-shell.tsx',
    registryFacts: {
      domainKeys: ['auth', 'user'],
      invalidations: { 'auth/sign-in': ['account'] },
      mutations: { 'auth/sign-in': 'typeof referenceSignIn' },
      queries: { account: 'typeof accountQuery' },
      routes: ['/', '/account', '/login'],
    },
    source: `
import { component } from '@kovojs/core';

export const ReferenceShell = component({
  queries: { account: accountQuery },
  render: ({ account }) => (
    <section>
      <h1>{account.name}</h1>
      <a href="/account">Account</a>
      <a href="/login">Sign in</a>
    </section>
  ),
});
`,
  });
}

function commerceComponentFixture(name: (typeof commerceComponentNames)[number]): CompileResult {
  const source = readFileSync(
    new URL(`../../../examples/commerce/src/components/${name}.tsx`, import.meta.url),
    'utf8',
  );
  return compileComponentModule({
    fileName: `examples/commerce/src/components/${name}.tsx`,
    registryFacts: commerceRegistryFacts(),
    source,
  });
}

function commerceRegistryFacts() {
  const fileName = 'examples/commerce/src/domain.ts';
  const source = readFileSync(
    new URL('../../../examples/commerce/src/domain.ts', import.meta.url),
    'utf8',
  );

  return {
    mutationInputs: Object.fromEntries(
      [...mutationInputFactsFromSource(fileName, source).values()].map((fact) => [
        fact.key,
        fact.fields.map((field) => ({ ...field, provenance: 'registry' as const })),
      ]),
    ),
    mutations: { 'cart/add': 'typeof addToCart' },
  };
}

function focusedGeneratedFixture(): CompileResult {
  return compileComponentModule({
    fileName: 'conformance/generated/cart-badge.tsx',
    queryShapes: {
      cart: {
        count: 'number',
        empty: 'boolean',
        items: [{ name: 'string', productId: 'string', qty: 'number' }],
      },
    },
    registryFacts: {
      queries: { cart: 'typeof cartQuery' },
      routes: ['/cart'],
    },
    source: `
import { component } from '@kovojs/core';

export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <cart-badge>
      <span>{cart.count}</span>
      <button hidden={cart.empty}>Checkout</button>
      <ul data-bind-list="cart.items" kovo-key="productId">
        <template kovo-stamp>
          <li><span data-bind=".qty">0</span> x <span data-bind=".name">Item</span></li>
        </template>
      </ul>
    </cart-badge>
  ),
});
`,
  });
}

function corpusArtifactFact(result: CompileResult): CorpusArtifactFact {
  assertFixpoint(result);
  assertRenderEquivalence(result);

  const server = fileByKind(result, 'server').source;
  const client = fileByKind(result, 'client').source;
  const registry = fileByKind(result, 'registry').source;

  return {
    clientExports: [...result.clientExports].sort(),
    componentGraphFacts: result.componentGraphFacts,
    cssAssetCount: result.cssAssets.length,
    diagnostics: result.diagnostics.map((diagnostic) => diagnostic.code),
    fileKinds: result.files.map((file) => file.kind),
    fixpoint: true,
    loweredSourceFacts: {
      hasCompilerIrHeader: server.startsWith('// @kovojs-ir'),
      hasComponentStamp: (result.loweredSource ?? '').includes('kovo-c='),
      hasQueryStamp: (result.loweredSource ?? '').includes('kovo-deps='),
    },
    moduleFacts: {
      clientHasNoHandlerFallback: client.includes('// no client handlers emitted'),
      clientHasQueryPlans: client.includes('$queryUpdatePlans'),
      registryHasRoutes: registry.includes("import('@kovojs/core').Route"),
      serverHasRenderSource: server.includes('export function renderSource()'),
    },
    name: result.componentGraphFacts[0]?.name ?? fileByKind(result, 'server').fileName,
    registryFacts: {
      hasComponentStylesheet: registry.includes('export interface ComponentStylesheets'),
      hasFragmentTargets: registry.includes('export interface FragmentTargets'),
      hasQueryUpdatePlans: registry.includes('export interface QueryUpdatePlans'),
      hasRouteRegistry: registry.includes('export interface RouteRegistry'),
    },
    renderEquivalence: result.renderEquivalenceChecks.map((check) => check.ok),
  };
}

function compilerDiagnosticFixtures(): Array<{ code: string; result: CompileResult }> {
  const simpleComponent = `
export const Shell = component({
  render: () => <section></section>,
});
`;

  return [
    {
      code: 'KV210',
      result: compileComponentModule({
        fileName: 'handlers.tsx',
        source: `
export const HandlerNames = component({
  state: () => ({ open: false }),
  render: () => <button onClick={() => state.open = true}>Open</button>,
});
`,
      }),
    },
    {
      code: 'KV211',
      result: compileComponentModule({
        fileName: 'execution.tsx',
        source: `
export const Execution = component({
  render: () => <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>,
});
`,
      }),
    },
    {
      code: 'KV212',
      result: compileComponentModule({
        fileName: 'execution.tsx',
        source: `
export const Execution = component({
  render: () => <video-player on:media="/c/video.client.js#Video$mount"></video-player>,
});
`,
      }),
    },
    {
      code: 'KV220',
      result: compileComponentModule({
        fileName: 'navigation.tsx',
        registryFacts: { routes: ['/cart'] },
        source: `
export const Navigation = component({
  render: () => <a href="/checkout">Checkout</a>,
});
`,
      }),
    },
    {
      code: 'KV221',
      result: compileComponentModule({
        fileName: 'idrefs.tsx',
        source: `
export const Idrefs = component({
  render: () => <label for="missing">Name</label>,
});
`,
      }),
    },
    {
      code: 'KV222',
      result: compileComponentModule({
        fileName: 'stamps.tsx',
        queryShapes: { cart: { count: 'number', total: 'number' } },
        source: `
export const Stamps = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.total">{cart.count}</span>,
});
`,
      }),
    },
    {
      code: 'KV223',
      result: compileComponentModule({
        fileName: 'stamps.tsx',
        queryShapes: { cart: { count: 'number' } },
        source: `
export const Stamps = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.count}</span>,
});
`,
      }),
    },
    {
      code: 'KV224',
      result: compileComponentModule({
        fileName: 'ids.tsx',
        source: `
export const Ids = component({
  render: () => <section><h2 id="title">A</h2><output id="title">B</output></section>,
});
`,
      }),
    },
    {
      code: 'KV225',
      result: compileComponentModule({
        fileName: 'markup.tsx',
        source: `
export const Markup = component({
  render: () => <p><div>Bad</div></p>,
});
`,
      }),
    },
    {
      code: 'KV226',
      result: compileComponentModule({
        fileName: 'residual.tsx',
        source: `
export const Residual = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <section kovo-c="unknown-component" kovo-deps="cart missing">{cart.count}</section>,
});
`,
      }),
    },
    {
      code: 'KV227',
      result: compileComponentModule({
        fileName: 'nullable.tsx',
        queryShapes: {
          product: { details: { kind: 'nullable', shape: { name: 'string' } } },
        },
        source: `
export const Nullable = component({
  render: () => <span data-bind="product.details.name">Coffee</span>,
});
`,
      }),
    },
    {
      code: 'KV231',
      result: compileComponentModule({
        fileName: 'primitive-conflicts.tsx',
        source: `
export const PrimitiveConflicts = component({
  render: () => <button commandfor="drawer" commandfor="confirm">Open</button>,
});
`,
      }),
    },
    {
      code: 'KV232',
      result: compileComponentModule({
        fileName: 'primitive-conflicts.tsx',
        source: `
export const PrimitiveConflicts = component({
  render: () => <button role="button" role="link">Open</button>,
});
`,
      }),
    },
    {
      code: 'KV233',
      result: compileComponentModule({
        fileName: 'primitive-conflicts.tsx',
        source: `
export const PrimitiveConflicts = component({
  render: () => <span data-bind="cart.count" data-bind="cart.total">2</span>,
});
`,
      }),
    },
    {
      code: 'KV234',
      result: compileComponentModule({
        fileName: 'prefixes.tsx',
        packageComponentPrefixes: [{ packageName: '@acme/widgets', prefix: 'kovo-' }],
        source: simpleComponent,
      }),
    },
    {
      code: 'KV301',
      result: compileComponentModule({
        fileName: 'state.tsx',
        source: `
export const State = component({
  queries: { cart: cartQuery },
  state: () => ({ saved: cart.count }),
  render: ({ cart }, state) => <span>{state.saved}</span>,
});
`,
      }),
    },
    {
      code: 'KV302',
      result: compileComponentModule({
        fileName: 'bindings.tsx',
        queryShapes: { cart: { count: 'number' } },
        source: `
export const Bindings = component({
  render: () => <span data-bind="cart.total">2</span>,
});
`,
      }),
    },
    {
      code: 'KV303',
      result: compileComponentModule({
        fileName: 'fragment.tsx',
        source: `
export const Fragment = component({
  queries: { cart: cartQuery },
  render: ({ cart, priceList }) => <section>{renderOnce(cart.count)}{priceList.version}</section>,
});
`,
      }),
    },
    {
      code: 'KV304',
      result: compileComponentModule({
        fileName: 'reserved-query.tsx',
        source: `
export const ReservedQuery = component({
  queries: { state: stateQuery },
  render: () => <section></section>,
});
`,
      }),
    },
    {
      code: 'KV320',
      result: compileComponentModule({
        fileName: 'events.tsx',
        queryShapes: { product: { unitPrice: 'number' } },
        source: `
export function notifyPrice(product, emit) {
  emit('cart:added', { product: { unitPrice: product.unitPrice } });
}
`,
      }),
    },
    {
      code: 'KV330',
      result: compileComponentModule({
        fileName: 'mutation.ts',
        source: `
export const addToCart = mutation('cart/add', {
  handler(input, request) {
    request.db.insert(cartItems).values(input);
  },
});
`,
      }),
    },
  ];
}

function diagnosticSnapshotFacts(diagnostics: readonly CompilerDiagnostic[]): Array<{
  code: string;
  help?: string;
  message: string;
  severity: string;
}> {
  return diagnostics.map(({ code, help, message, severity }) => ({
    code,
    ...(help === undefined ? {} : { help: normalizeDiagnosticHelp(help) }),
    message: normalizeDiagnosticHelp(message),
    severity,
  }));
}

function normalizeDiagnosticHelp(text: string): string {
  return text.replaceAll(/\/c\/__v\/[0-9a-f]{8}\//g, '/c/__v/<version>/');
}

function fileByKind(result: CompileResult, kind: EmittedFile['kind']): EmittedFile {
  const matches = result.files.filter((file) => file.kind === kind);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${kind} artifact; found ${matches.length}`);
  }
  return matches[0]!;
}

function executeClientModule(source: string): Record<string, unknown> {
  const exports: Record<string, unknown> = {};
  const moduleSource = source
    .replace(
      /import\s+\{([^}]+)\}\s+from\s+['"]@kovojs\/runtime(?:\/generated)?['"];\n?/g,
      (_match, names: string) => `const { ${names.trim()} } = runtime;\n`,
    )
    .replace(/export const ([A-Za-z_$][\w$]*)/g, 'const $1 = exports.$1');

  runInNewContext(
    moduleSource,
    {
      exports,
      runtime: {
        applyCompiledQueryUpdatePlan,
        derive,
        kovoEscapeHtml,
        kovoStyleProperty,
      },
    },
    { timeout: 1000 },
  );

  return exports;
}

class FakeElement {
  attributes: Array<{ name: string; value: string }>;
  textContent: string | null;

  constructor(attributes: Record<string, string>, options: { textContent?: string } = {}) {
    this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value }));
    this.textContent = options.textContent ?? null;
  }

  closest(selector: string): FakeElement | null {
    return this.matches(selector) ? this : null;
  }

  getAttribute(name: string): string | null {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }

  matches(selector: string): boolean {
    const exact = /^\[([^=\]]+)="([^"]*)"\]$/.exec(selector);
    if (exact) return this.getAttribute((exact[1] ?? '').replaceAll('\\:', ':')) === exact[2];

    const present = /^\[([^=\]]+)\]$/.exec(selector);
    return present ? this.getAttribute((present[1] ?? '').replaceAll('\\:', ':')) !== null : false;
  }

  removeAttribute(name: string): void {
    this.attributes = this.attributes.filter((attribute) => attribute.name !== name);
  }

  setAttribute(name: string, value: string): void {
    const existing = this.attributes.find((attribute) => attribute.name === name);
    if (existing) {
      existing.value = value;
      return;
    }
    this.attributes.push({ name, value });
  }
}

class FakeTemplateHost extends FakeElement {
  items: Array<{ html: string; key: string }> = [];

  reconcileTemplateStamp(items: Array<{ html: string; key: string }>): void {
    this.items = items.map((item) => ({ html: item.html, key: item.key }));
    this.textContent = items.map((item) => item.html).join('');
  }
}

class FakeRoot {
  constructor(
    readonly bindings: readonly FakeElement[],
    readonly elements: readonly FakeElement[],
  ) {}

  querySelectorAll(selector: string): FakeElement[] {
    if (selector === '[data-bind]') {
      return this.bindings.filter((element) => element.getAttribute('data-bind') !== null);
    }
    if (selector === '*') return [...this.bindings, ...this.elements];
    return [...this.bindings, ...this.elements].filter((element) => element.matches(selector));
  }
}
