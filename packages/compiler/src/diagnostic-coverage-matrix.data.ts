import type { DiagnosticCode } from '@kovojs/core/internal/diagnostics';

import { deriveRegistryFactsFromGraph } from './app-graph.js';
import { compileComponentModule, deriveAppGraph } from './index.js';
import { queryShapeFactDiagnostics } from './internal.js';
import type { CompilerDiagnostic } from './diagnostics.js';

type DiagnosticRunner = () => readonly CompilerDiagnostic[];

interface DiagnosticMatrixRow {
  code: DiagnosticCode;
  negative: DiagnosticRunner;
  positive: DiagnosticRunner;
  spec: string;
}

interface OutOfScopeDiagnosticRow {
  code: DiagnosticCode;
  reason: string;
}

export const compilerOwnedDiagnosticMatrix = [
  {
    code: 'KV201',
    spec: 'SPEC.md §4.3/§5.2',
    positive: () =>
      compileComponentModule({
        fileName: 'handler-captures-ok.tsx',
        source: `
import { openPanel } from './actions';

export const HandlerCapturesOk = component({
  state: () => ({ open: false }),
  render: () => <button onClick={openPanel}>Open</button>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'handler-captures-bad.tsx',
        source: '<button onClick={() => window.alert("x")}>x</button>',
      }).diagnostics,
  },
  {
    code: 'KV210',
    spec: 'SPEC.md §5.2',
    positive: () =>
      compileComponentModule({
        fileName: 'handler-name-ok.tsx',
        source: `
import { openPanel } from './actions';

export const HandlerNameOk = component({
  state: () => ({ open: false }),
  render: () => <button onClick={openPanel}>Open</button>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'handler-name-bad.tsx',
        source: `
export const HandlerNameBad = component({
  state: () => ({ open: false }),
  render: () => <button onClick={() => state.open = true}>Open</button>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV211',
    spec: 'SPEC.md §4.7',
    positive: () =>
      compileComponentModule({
        fileName: 'trigger-load-ok.tsx',
        source: `
export const TriggerLoadOk = component({
  render: () => (
    <stock-ticker>
      {/* KV211: market-open pages intentionally start this ticker at parse time. */}
      <span on:load="/c/ticker.client.js#Ticker$start">Open</span>
    </stock-ticker>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'trigger-load-bad.tsx',
        source: `
export const TriggerLoadBad = component({
  render: () => <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV212',
    spec: 'SPEC.md §4.7',
    positive: () =>
      compileComponentModule({
        fileName: 'trigger-known-ok.tsx',
        source: `
export const TriggerKnownOk = component({
  render: () => <video-player on:visible="/c/video.client.js#Video$mount"></video-player>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'trigger-known-bad.tsx',
        source: `
export const TriggerKnownBad = component({
  render: () => <video-player on:media="/c/video.client.js#Video$mount"></video-player>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV220',
    spec: 'SPEC.md §6.4/§9.5',
    positive: () =>
      compileComponentModule({
        fileName: 'navigation-ok.tsx',
        registryFacts: { routes: ['/cart'] },
        source: `
export const NavigationOk = component({
  render: () => <a href="/cart">Cart</a>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'navigation-bad.tsx',
        registryFacts: { routes: ['/cart'] },
        source: `
export const NavigationBad = component({
  render: () => <a href="/checkout">Checkout</a>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV221',
    spec: 'SPEC.md §4.5/§6.4',
    positive: () =>
      compileComponentModule({
        fileName: 'idref-ok.tsx',
        source: `
export const IdrefOk = component({
  render: () => (
    <section>
      <input id="name" />
      <label for="name">Name</label>
    </section>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'idref-bad.tsx',
        source: `
export const IdrefBad = component({
  render: () => <label for="missing">Name</label>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV222',
    spec: 'SPEC.md §4.8',
    positive: () =>
      compileComponentModule({
        fileName: 'binding-drift-ok.tsx',
        queryShapes: { cart: { count: 'number' } },
        source: `
export const BindingDriftOk = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span>{cart.count}</span>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'binding-drift-bad.tsx',
        queryShapes: { cart: { count: 'number', total: 'number' } },
        source: `
export const BindingDriftBad = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.total">{cart.count}</span>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV223',
    spec: 'SPEC.md §4.8',
    positive: () =>
      compileComponentModule({
        fileName: 'binding-redundancy-ok.tsx',
        queryShapes: { cart: { count: 'number' } },
        source: `
export const BindingRedundancyOk = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span>{cart.count}</span>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'binding-redundancy-bad.tsx',
        queryShapes: { cart: { count: 'number' } },
        source: `
export const BindingRedundancyBad = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.count}</span>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV224',
    spec: 'SPEC.md §4.5',
    positive: () =>
      compileComponentModule({
        fileName: 'ids-ok.tsx',
        source: `
export const IdsOk = component({
  render: () => <section><h2 id="title">A</h2><output id="summary">B</output></section>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'ids-bad.tsx',
        source: `
export const IdsBad = component({
  render: () => <section><h2 id="title">A</h2><output id="title">B</output></section>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV225',
    spec: 'SPEC.md §4.2',
    positive: () =>
      compileComponentModule({
        fileName: 'markup-ok.tsx',
        source: `
export const MarkupOk = component({
  render: () => <section><p>Good</p><div>Still good</div></section>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'markup-bad.tsx',
        source: `
export const MarkupBad = component({
  render: () => <p><div>Bad</div></p>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV226',
    spec: 'SPEC.md §5.2',
    positive: () =>
      compileComponentModule({
        fileName: 'residual-ok.tsx',
        source: `
export const ResidualOk = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section kovo-c="residual-ok" kovo-deps="cart">
      <span>{cart.count}</span>
    </section>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'residual-bad.tsx',
        source: `
export const ResidualBad = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section kovo-c="unknown-component" kovo-deps="cart">
      <span>{cart.count}</span>
    </section>
  ),
});
`,
      }).diagnostics,
  },
  {
    code: 'KV227',
    spec: 'SPEC.md §4.8',
    positive: () =>
      compileComponentModule({
        fileName: 'nullable-ok.tsx',
        queryShapes: {
          product: { details: { kind: 'nullable', shape: { name: 'string' } } },
        },
        source: `
export const NullableOk = component({
  render: () => <span data-bind="product.details?.name">Coffee</span>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'nullable-bad.tsx',
        queryShapes: {
          product: { details: { kind: 'nullable', shape: { name: 'string' } } },
        },
        source: `
export const NullableBad = component({
  render: () => <span data-bind="product.details.name">Coffee</span>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV228',
    spec: 'SPEC.md §9.5',
    positive: () =>
      deriveAppGraph({
        graph: {
          pages: [{ route: '/cart' }, { route: '/products/:id' }],
        },
      }).diagnostics,
    negative: () =>
      deriveAppGraph({
        graph: {
          pages: [{ route: '/cart' }, { route: '/cart' }, { route: '/products/:id' }],
        },
      }).diagnostics,
  },
  {
    code: 'KV230',
    spec: 'SPEC.md §4.5',
    positive: () =>
      compileComponentModule({
        fileName: 'fragment-children-ok.tsx',
        source: `
export const CartRow = component({
  queries: { cart: cartQuery },
  props: { rowId: String },
  render: ({ rowId }, _state, { children }) => <tr data-row={rowId}>{children}</tr>,
});

export const CartTable = component({
  render: ({ cart }) => (
    <table>
      <CartRow rowId={cart.rowId}>
        <span>{cart.rowId}</span>
      </CartRow>
    </table>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'fragment-children-bad.tsx',
        source: `
export const CartRow = component({
  queries: { cart: cartQuery },
  props: { rowId: String },
  render: ({ rowId }) => <tr kovo-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component({
  render: ({ cart }) => {
    const snapshot = readSnapshot();
    return (
      <table>
        <CartRow rowId={cart.rowId}>
          <span>{snapshot.total}</span>
        </CartRow>
      </table>
    );
  },
});
`,
      }).diagnostics,
  },
  {
    code: 'KV231',
    spec: 'SPEC.md §4.6',
    positive: () =>
      compileComponentModule({
        fileName: 'attribute-conflict-ok.tsx',
        source: `
export const AttributeConflictOk = component({
  render: () => <button commandfor="drawer">Open</button>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'attribute-conflict-bad.tsx',
        source: `
export const AttributeConflictBad = component({
  render: () => <button commandfor="drawer" commandfor="confirm">Open</button>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV232',
    spec: 'SPEC.md §4.6',
    positive: () =>
      compileComponentModule({
        fileName: 'attribute-override-ok.tsx',
        source: `
export const AttributeOverrideOk = component({
  render: () => <button role="button">Open</button>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'attribute-override-bad.tsx',
        source: `
export const AttributeOverrideBad = component({
  render: () => <button role="button" role="link">Open</button>,
});
`,
      }).diagnostics,
  },
  {
    // SPEC.md §4.6: state-bearing aria-* is primitive-wins; a static author value that
    // contradicts the primitive's render-time value is an error (KV317), not a lint (KV232).
    // The positive fixture passes matching primitive+author state-aria → KV232 lint, not KV317.
    // The negative fixture passes contradicting values → KV317 error.
    // Both use the attrs= primitive composition pattern so they route through
    // mergePrimitiveAndAuthorAttributes where KV317 is emitted.
    code: 'KV317',
    spec: 'SPEC.md §4.6',
    positive: () =>
      compileComponentModule({
        fileName: 'state-aria-no-contradiction.tsx',
        source: `
export const StateAriaNoContradiction = component({
  render: () => (
    <state-aria-no-contradiction>
      <Tooltip.Trigger attrs={{ 'aria-expanded': 'true' }}>
        {(attrs) => <button {...attrs} aria-expanded="true">Toggle</button>}
      </Tooltip.Trigger>
    </state-aria-no-contradiction>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'state-aria-contradiction.tsx',
        source: `
export const StateAriaContradiction = component({
  render: () => (
    <state-aria-contradiction>
      <Tooltip.Trigger attrs={{ 'aria-expanded': 'true' }}>
        {(attrs) => <button {...attrs} aria-expanded="false">Toggle</button>}
      </Tooltip.Trigger>
    </state-aria-contradiction>
  ),
});
`,
      }).diagnostics,
  },
  {
    code: 'KV233',
    spec: 'SPEC.md §4.6/§4.8',
    positive: () =>
      compileComponentModule({
        fileName: 'binding-slot-ok.tsx',
        source: `
export const BindingSlotOk = component({
  render: () => <span data-bind="cart.count" data-bind:aria-label="cart.count">2</span>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'binding-slot-bad.tsx',
        source: `
export const BindingSlotBad = component({
  render: () => <span data-bind="cart.count" data-bind="cart.total">2</span>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV234',
    spec: 'SPEC.md §6.1.1',
    positive: () =>
      compileComponentModule({
        fileName: 'prefix-ok.tsx',
        packageComponentPrefixes: [{ packageName: '@acme/widgets', prefix: 'acme-' }],
        source: `
export const PrefixOk = component({
  render: () => <section></section>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'prefix-bad.tsx',
        packageComponentPrefixes: [{ packageName: '@acme/widgets', prefix: 'kovo-' }],
        source: `
export const PrefixBad = component({
  render: () => <section></section>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV235',
    spec: 'SPEC.md §5.2',
    positive: () =>
      compileComponentModule({
        fileName: 'authoring-surface-ok.tsx',
        source: `
export const AuthoringSurfaceOk = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <cart-badge><span>{cart.count}</span></cart-badge>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'authoring-surface-bad.tsx',
        source: `
export const AuthoringSurfaceBad = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => \`<cart-badge kovo-deps="cart"><span data-bind="cart.count">\${cart.count}</span></cart-badge>\`,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV244',
    spec: 'SPEC.md §8',
    positive: () =>
      compileComponentModule({
        fileName: 'defer-jsx-ok.tsx',
        source: `
import { Defer } from '@kovojs/server';

export const DeferJsxOk = component({
  render: () => <main><Defer target="panel" render={() => <section>Ready</section>} /></main>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'defer-jsx-bad.tsx',
        source: `
import { defer } from '@kovojs/server';

export const DeferJsxBad = component({
  render: () => <main>{defer({ target: 'panel', priority: 'after-paint', render: () => '<section>Ready</section>' })}</main>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV245',
    spec: 'SPEC.md §5.2',
    positive: () =>
      compileComponentModule({
        fileName: 'parse-ok.tsx',
        source: `
export const ParseOk = component({
  render: () => <section><span>Ready</span></section>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'parse-bad.tsx',
        source: `
export const ParseBad = component({
  render: () => <section><span>Broken</section>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV236',
    spec: 'SPEC.md §1/§5.2',
    positive: () =>
      compileComponentModule({
        fileName: 'output-context-ok.tsx',
        registryFacts: { routes: ['/pricing'] },
        source: `
export const OutputContextOk = component({
  render: ({ product }) => (
    <article title={product.name} aria-label={product.name}>
      <a href="/pricing">Pricing</a>
      <h2>{product.name}</h2>
    </article>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'output-context-bad.tsx',
        registryFacts: { routes: ['/pricing'] },
        source: `
export const OutputContextBad = component({
  render: () => <a href="javascript:alert(1)">bad</a>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV237',
    spec: 'SPEC.md §6.1.1',
    positive: () =>
      compileComponentModule({
        fileName: 'component-name-ok.tsx',
        source: `
export const CartBadge = component({
  render: () => <cart-badge></cart-badge>,
});

export const MiniCartBadge = component({
  render: () => <mini-cart-badge></mini-cart-badge>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'component-name-bad.tsx',
        source: `
export const CartBadge = component({
  render: () => <cart-badge></cart-badge>,
});

export const Cart_Badge = component({
  render: () => <mini-cart-badge></mini-cart-badge>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV238',
    spec: 'SPEC.md §4.5/§6.2',
    positive: () =>
      compileComponentModule({
        fileName: 'fragment-target-name-ok.tsx',
        source: `
export const ProductGrid = component({
  queries: { productGrid: productGridQuery },
  render: () => <product-grid></product-grid>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'fragment-target-name-bad.tsx',
        source: `
export const ProductGrid = component({
  queries: { productGrid: productGridQuery },
  render: () => <product-grid></product-grid>,
});

export const Product_Grid = component({
  queries: { productGrid: productGridQuery },
  render: () => <mini-grid></mini-grid>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV242',
    spec: 'SPEC.md §6.2/§6.3',
    positive: () =>
      compileComponentModule({
        fileName: 'form-fields-ok.tsx',
        source: `
export const addToCart = mutation('cart/add', {
  input: s.object({
    productId: s.string(),
    quantity: s.number().int().min(1).default(1),
  }),
  handler() {
    return null;
  },
});

export const AddToCartForm = component({
  render: () => (
    <form enhance mutation={addToCart}>
      <input type="hidden" name="productId" value="p1" />
    </form>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'form-fields-bad.tsx',
        source: `
export const addToCart = mutation('cart/add', {
  input: s.object({ productId: s.string() }),
  handler() {
    return null;
  },
});

export const AddToCartForm = component({
  render: () => (
    <form enhance mutation={addToCart}>
      <input name="product" value="p1" />
    </form>
  ),
});
`,
      }).diagnostics,
  },
  {
    code: 'KV243',
    spec: 'SPEC.md §9.1',
    positive: () =>
      compileComponentModule({
        fileName: 'stream-target-ok.tsx',
        source: `
export const StreamTargetOk = component({
  render: () => <p streamText="message:a1"></p>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'stream-target-bad.tsx',
        source: `
export const StreamTargetBad = component({
  render: () => <p streamText="#message"></p>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV239',
    spec: 'SPEC.md §8',
    positive: () =>
      compileComponentModule({
        fileName: 'view-transition-ok.tsx',
        source: `
export const ViewTransitionOk = component({
  render: () => (
    <section>
      <img viewTransitionName="product-hero" src="/hero.png" />
      <img viewTransitionName="product-thumb" src="/thumb.png" />
    </section>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'view-transition-bad.tsx',
        source: `
export const ViewTransitionBad = component({
  render: () => (
    <section>
      <img viewTransitionName="product-hero" src="/hero.png" />
      <img viewTransitionName="product-hero" src="/thumb.png" />
    </section>
  ),
});
`,
      }).diagnostics,
  },
  {
    code: 'KV240',
    spec: 'SPEC.md §4.8',
    positive: () =>
      queryShapeFactDiagnostics('query-shapes-ok.tsx', [
        {
          query: 'cart',
          shape: { count: 'number' },
          source: 'generated/queries/cart.shape.ts',
        },
        {
          query: 'productGrid',
          shape: { items: [{ id: 'string' }] },
          source: 'generated/queries/product-grid.shape.ts',
        },
      ]),
    negative: () =>
      queryShapeFactDiagnostics('query-shapes-bad.tsx', [
        {
          query: 'cart',
          shape: { count: 'number' },
          source: 'generated/queries/cart.shape.ts',
        },
        {
          query: 'cart',
          shape: { total: 'number' },
          source: 'generated/queries/cart-refresh.shape.ts',
        },
      ]),
  },
  {
    code: 'KV241',
    spec: 'SPEC.md §4.2/§4.8',
    positive: () =>
      compileComponentModule({
        fileName: 'component-key-stability-ok.tsx',
        previousRegistryFacts: {
          components: ['component-key-stability-ok/component-key-stability-ok'],
        },
        source: `
export const ComponentKeyStabilityOk = component({
  render: () => <component-key-stability-ok></component-key-stability-ok>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'components/cart/badge.tsx',
        previousRegistryFacts: { components: ['components/old-cart/cart-badge'] },
        source: `
export const CartBadge = component({
  render: () => <cart-badge></cart-badge>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV301',
    spec: 'SPEC.md §4.1',
    positive: () =>
      compileComponentModule({
        fileName: 'state-ownership-ok.tsx',
        source: `
export const StateOwnershipOk = component({
  state: () => ({ open: false }),
  render: (_queries, state) => <span>{state.open}</span>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'state-ownership-bad.tsx',
        source: `
export const StateOwnershipBad = component({
  queries: { cart: cartQuery },
  state: () => ({ saved: cart.count }),
  render: ({ cart }, state) => <span>{state.saved}</span>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV302',
    spec: 'SPEC.md §4.8/§6.2',
    positive: () =>
      compileComponentModule({
        fileName: 'binding-shape-ok.tsx',
        queryShapes: { cart: { count: 'number' } },
        source: `
export const BindingShapeOk = component({
  render: () => <span data-bind="cart.count">2</span>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'binding-shape-bad.tsx',
        queryShapes: { cart: { count: 'number' } },
        source: `
export const BindingShapeBad = component({
  render: () => <span data-bind="cart.total">2</span>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV303',
    spec: 'SPEC.md §4.5',
    positive: () =>
      compileComponentModule({
        fileName: 'fragment-input-ok.tsx',
        source: `
export const FragmentInputOk = component({
  props: { priceList: String },
  render: ({ priceList }) => <section>{priceList}</section>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'fragment-input-bad.tsx',
        source: `
export const FragmentInputBad = component({
  queries: { cart: cartQuery },
  render: ({ cart, priceList }) => <section>{renderOnce(cart.count)}{priceList.version}</section>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV304',
    spec: 'SPEC.md §4.8',
    positive: () =>
      compileComponentModule({
        fileName: 'reserved-query-ok.tsx',
        source: `
export const ReservedQueryOk = component({
  queries: { cart: cartQuery },
  render: () => <section></section>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'reserved-query-bad.tsx',
        source: `
export const ReservedQueryBad = component({
  queries: { state: stateQuery },
  render: () => <section></section>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV311',
    spec: 'SPEC.md §4.9',
    positive: () =>
      compileComponentModule({
        fileName: 'coverage-ok.tsx',
        source: `
export const CoverageOk = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.count}</span>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'coverage-bad.tsx',
        source: `
export const CoverageBad = component({
  queries: { cart: cartQuery },
  disableServerRefresh: true,
  render: ({ cart }) => <strong className={cart.discount}>Discount</strong>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV312',
    spec: 'SPEC.md §4.8/§4.9',
    positive: () =>
      compileComponentModule({
        fileName: 'clock-render-ok.tsx',
        source: `
export const ClockRenderOk = component({
  clocks: { ago: { every: '30s' } },
  render: ({ now }) => <time>{formatRelative(now.ago)}</time>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'clock-render-bad.tsx',
        source: `
export const ClockRenderBad = component({
  render: ({ now }) => <time>{formatRelative(now.ago)}</time>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV315',
    spec: 'SPEC.md §4.8/§4.9',
    positive: () =>
      compileComponentModule({
        fileName: 'clock-derive-ok.tsx',
        source: `
export const ClockDeriveOk$label = derive(['cart'], (cart) => cart.count);

export const ClockDeriveOk = component({
  render: () => <output data-derive="cart.ClockDeriveOk$label">0</output>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'clock-derive-bad.tsx',
        source: `
export const ClockDeriveBad$label = derive(['cart'], (cart) => Date.now() - new Date().getTime());

export const ClockDeriveBad = component({
  render: () => <output data-derive="cart.ClockDeriveBad$label">0</output>,
});
`,
      }).diagnostics,
  },
  {
    code: 'KV316',
    spec: 'SPEC.md §4.5/§4.8',
    positive: () =>
      compileComponentModule({
        fileName: 'isomorphic-slot-ok.tsx',
        source: `
export const IsomorphicSlotOk = component({
  isomorphic: true,
  queries: { cart: cartQuery },
  render: ({ cart }) => <cart-badge>{cart.count}</cart-badge>,
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'isomorphic-slot-bad.tsx',
        source: `
export const IsomorphicSlotBad = component({
  isomorphic: true,
  queries: { cart: cartQuery },
  render: ({ cart }, _state, { children }) => (
    <cart-badge>
      {children}
      <strong>{cart.count}</strong>
    </cart-badge>
  ),
});
`,
      }).diagnostics,
  },
  {
    code: 'KV320',
    spec: 'SPEC.md §6.4',
    positive: () =>
      compileComponentModule({
        fileName: 'event-payload-ok.tsx',
        source: `
export function notifyCart(emit) {
  emit('cart:added', { quantity: 1 });
}
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'event-payload-bad.tsx',
        queryShapes: { product: { unitPrice: 'number' } },
        source: `
export function notifyPrice(product, emit) {
  emit('cart:added', { product: { unitPrice: product.unitPrice } });
}
`,
      }).diagnostics,
  },
  {
    code: 'KV330',
    spec: 'SPEC.md §11.4/§14',
    positive: () =>
      compileComponentModule({
        fileName: 'mutation-surface-ok.ts',
        source: `
export const addToCart = mutation('cart/add', {
  handler(input) {
    return addCartItem(input);
  },
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'mutation-surface-bad.ts',
        source: `
export const addToCart = mutation('cart/add', {
  handler(input, request) {
    request.db.insert(cartItems).values(input);
  },
});
`,
      }).diagnostics,
  },
  {
    code: 'KV420',
    spec: 'SPEC.md §4.5/§4.9/§9.1',
    positive: () =>
      compileComponentModule({
        fileName: 'stateful-fragment-ok.tsx',
        source: `
export const Stepper = component({
  state: () => ({ count: 0 }),
  render: (_, state) => <span>{state.count}</span>,
});

export const CartPanel = component({
  render: () => (
    <section>
      <Stepper />
    </section>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'stateful-fragment-bad.tsx',
        source: `
export const Stepper = component({
  state: () => ({ count: 0 }),
  render: (_, state) => <span>{state.count}</span>,
});

export const CartPanel = component({
  queries: { cart: {} },
  render: ({ cart }) => (
    <section>
      <p>{cart.total}</p>
      <Stepper />
    </section>
  ),
});
`,
      }).diagnostics,
  },
  {
    code: 'KV421',
    spec: 'SPEC.md §6.1/§9.5',
    positive: () =>
      deriveRegistryFactsFromGraph({
        mutations: [
          { key: 'cart/add', writes: ['cart'] },
          { key: 'cart/remove', writes: ['order'] },
        ],
        queries: [
          { domains: ['cart'], query: 'cart' },
          { domains: ['order'], query: 'orderHistory' },
        ],
      }).diagnostics ?? [],
    negative: () =>
      deriveRegistryFactsFromGraph({
        mutations: [
          { key: 'cart/add', writes: ['cart'] },
          { key: 'cart/add', writes: ['order'] },
        ],
        queries: [
          { domains: ['cart'], query: 'cart' },
          { domains: ['order'], query: 'orderHistory' },
        ],
      }).diagnostics ?? [],
  },
  {
    code: 'KV435',
    spec: 'SPEC.md §6.2/§6.6/§10.2',
    positive: () =>
      compileComponentModule({
        fileName: 'query-wire-ok.tsx',
        queryShapes: {
          user: {
            id: 'string',
            name: 'string',
          },
        },
        source: `
export const UserCard = component({
  queries: { user: {} },
  render: () => (
    <user-card>
      <span data-bind="user.id">u1</span>
    </user-card>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'query-wire-bad.tsx',
        queryShapes: {
          user: {
            id: 'string',
            passwordHash: {
              kind: 'secret',
              shape: 'string',
            },
          },
        },
        source: `
export const UserCard = component({
  queries: { user: {} },
  render: () => (
    <user-card>
      <span data-bind="user.id">u1</span>
    </user-card>
  ),
});
`,
      }).diagnostics,
  },
  {
    code: 'KV437',
    spec: 'SPEC.md §6.2/§6.6',
    positive: () =>
      compileComponentModule({
        fileName: 'client-capture-ok.tsx',
        source: `
import { track } from './analytics';

export const Badge = component({
  render: () => (
    <button onClick={() => track('click')}>Track</button>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      compileComponentModule({
        fileName: 'client-capture-bad.tsx',
        source: `
import { sendPayment } from './payments';
import { STRIPE_SECRET_KEY } from './secrets';

export const PayButton = component({
  render: () => (
    <button onClick={() => sendPayment(STRIPE_SECRET_KEY)}>Pay</button>
  ),
});
`,
      }).diagnostics,
  },
] as const satisfies readonly DiagnosticMatrixRow[];

export const outOfScopeCompilerDiagnostics = [
  {
    code: 'KV310',
    reason:
      'Compiler-owned, but emitted by the optimistic coverage/check path (`tests/kovo-check.node.mjs`) rather than compileComponentModule/deriveAppGraph/query-shape validation.',
  },
  {
    code: 'KV314',
    reason:
      'Compiler-owned, but emitted by the kovo check coverage graph path (`packages/cli/src/index.kovo-check.test.ts`) rather than compileComponentModule/deriveAppGraph/query-shape validation.',
  },
  {
    code: 'KV422',
    reason:
      'Security-heavy, but produced by the Drizzle/static SQL analyzer and carried through compile/check graph diagnostics rather than by component compilation or app graph derivation.',
  },
  {
    code: 'KV423',
    reason:
      'Security-heavy, but raw endpoint metadata ownership currently lives in server/check graph producers; no compiler-owned row is claimed until endpoint extraction is compiler-derived.',
  },
  {
    code: 'KV424',
    reason:
      'Security-heavy, but produced by source/sink and kovo check graph diagnostics for app-authored dangerous sinks rather than component compilation.',
  },
  {
    code: 'KV425',
    reason:
      'Security-heavy, but source/sink drift detection is a repository audit/check path, not compiler component or registry graph output.',
  },
  {
    code: 'KV426',
    reason:
      'Security-heavy, but trust-escape provenance is surfaced by kovo explain/check graph paths; component compilation only preserves facts when supplied.',
  },
  {
    code: 'KV428',
    reason:
      'Security-heavy, but upload content-disposition/type enforcement is runtime/server-owned and not emitted by the compiler diagnostic path.',
  },
  {
    code: 'KV429',
    reason:
      'Security-heavy, but lost-update write provenance is enforced by kovo check graph diagnostics, not component compilation.',
  },
  {
    code: 'KV430',
    reason:
      'Security-heavy, but schema breadth/depth budget linting is schema/check ownership and not emitted by component compilation.',
  },
  {
    code: 'KV431',
    reason:
      'Security-heavy, but client-module manifest completeness is deployment/check ownership rather than compiler-owned component diagnostics.',
  },
  {
    code: 'KV432',
    reason:
      'Security-heavy, but cookie-attribute floors are server/runtime sink ownership rather than compiler-owned component diagnostics.',
  },
  {
    code: 'KV433',
    reason:
      'Security-heavy, but write-reaching query loaders are enforced by kovo check graph diagnostics, not component compilation.',
  },
  {
    code: 'KV434',
    reason:
      'Security-heavy, but regex/schema analyzer ownership is outside the compiler component/registry diagnostic matrix.',
  },
  {
    code: 'KV436',
    reason:
      'Security-heavy, but the compiler derives access facts while kovo check consumes undecided facts as KV436 diagnostics.',
  },
  {
    code: 'KV438',
    reason:
      'Security-heavy, but governed-column mass-assignment is enforced by kovo check graph diagnostics rather than compiler-owned component or registry diagnostics.',
  },
] as const satisfies readonly OutOfScopeDiagnosticRow[];
