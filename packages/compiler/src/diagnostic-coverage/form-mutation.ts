import { coverageFixtures } from './fixture-runners.js';
import { defineDiagnosticCoverage } from './registration.js';

export const formMutationDiagnosticCoverage = defineDiagnosticCoverage('form-mutation', [
  {
    code: 'KV242',
    spec: 'SPEC.md §6.2/§6.3',
    positive: () =>
      coverageFixtures.compileComponentModule({
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
      coverageFixtures.compileComponentModule({
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
    code: 'KV330',
    spec: 'SPEC.md §11.4/§14',
    positive: () =>
      coverageFixtures.compileComponentModule({
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
      coverageFixtures.compileComponentModule({
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
    code: 'KV426',
    spec: 'SPEC.md §9.1/§5.2 #10/§4.8',
    positive: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'trusted-html-provenance-ok.tsx',
        source: `
import { safeRichHtml, trustedHtml } from '@kovojs/browser';

export const PostBody = component({
  queries: { post: postQuery },
  render: ({ post }) => (
    <article>
      {safeRichHtml(post.body)}
      {trustedHtml('<hr/>')}
      {trustedHtml(post.title, 'admin-curated title, sanitized upstream')}
    </article>
  ),
});
`,
      }).diagnostics,
    negative: () =>
      coverageFixtures.compileComponentModule({
        fileName: 'trusted-html-provenance-bad.tsx',
        source: `
import { trustedHtml } from '@kovojs/browser';

export const PostBody = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{trustedHtml(post.body)}</article>,
});
`,
      }).diagnostics,
  },
]);
