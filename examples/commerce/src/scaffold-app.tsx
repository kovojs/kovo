/** @jsxImportSource @kovojs/server */
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';
import * as style from '@kovojs/style';

import { app } from './scaffold-kovo.js';
import { reserveProduct } from './scaffold-mutations.js';

const styles = style.create({
  shell: {
    backgroundColor: style.tokens.sys.color.surface,
    color: style.tokens.sys.color.onSurface,
    marginInline: 'auto',
    maxWidth: 1120,
    minHeight: '100dvh',
    paddingBlock: 32,
    paddingInline: 24,
  },
  stack: { display: 'grid', gap: 24 },
  eyebrow: {
    color: style.tokens.sys.color.primary,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  heading: {
    fontSize: 36,
    fontWeight: 750,
    letterSpacing: 0,
    lineHeight: 1.1,
    margin: 0,
  },
  summary: {
    color: style.tokens.sys.color.onSurfaceVariant,
    fontSize: 16,
    lineHeight: 1.6,
    margin: 0,
    maxWidth: 680,
  },
  productGrid: {
    display: 'grid',
    gap: 16,
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    '@media (max-width: 800px)': { gridTemplateColumns: '1fr' },
  },
  product: { display: 'grid', gap: 14 },
  productTop: {
    alignItems: 'start',
    display: 'flex',
    gap: 12,
    justifyContent: 'space-between',
  },
  productName: { fontSize: 17, fontWeight: 650, margin: 0 },
  productMeta: {
    color: style.tokens.sys.color.onSurfaceVariant,
    fontSize: 14,
    margin: 0,
  },
  price: {
    fontSize: 24,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 700,
    margin: 0,
  },
  action: {
    alignItems: 'end',
    display: 'grid',
    gap: 10,
    gridTemplateColumns: '1fr auto',
  },
  field: {
    color: style.tokens.sys.color.onSurfaceVariant,
    display: 'grid',
    fontSize: 12,
    fontWeight: 600,
    gap: 6,
  },
  select: {
    backgroundColor: style.tokens.sys.color.surfaceContainerLowest,
    borderColor: style.tokens.sys.color.outline,
    borderRadius: style.tokens.sys.shape.cornerSmall,
    borderStyle: 'solid',
    borderWidth: 1,
    color: style.tokens.sys.color.onSurface,
    minHeight: 38,
    paddingInline: 10,
  },
  notice: {
    backgroundColor: style.tokens.sys.color.secondaryContainer,
    borderRadius: style.tokens.sys.shape.cornerMedium,
    color: style.tokens.sys.color.onSecondaryContainer,
    margin: 0,
    paddingBlock: 12,
    paddingInline: 16,
  },
  proof: {
    borderColor: style.tokens.sys.color.outlineVariant,
    borderRadius: style.tokens.sys.shape.cornerMedium,
    borderStyle: 'solid',
    borderWidth: 1,
    color: style.tokens.sys.color.onSurfaceVariant,
    display: 'grid',
    fontSize: 14,
    gap: 8,
    padding: 16,
  },
});

const StorefrontLayout = app.layout({
  access: app.publicAccess('public commerce scaffold catalog'),
  render: (_queries, _state, { children }) => <div style={styles.shell}>{children}</div>,
});

const storefrontRoute = app.route('/', {
  access: app.publicAccess('public commerce scaffold catalog'),
  layout: StorefrontLayout,
  meta: {
    description: 'A buildable Kovo storefront with a typed reservation mutation.',
    title: 'Lumen Supply · Kovo',
  },
  page(context) {
    const reserved = context.search.reserved === '1';
    return (
      <main style={styles.stack}>
        <div style={styles.stack}>
          <span style={styles.eyebrow}>Lumen Supply</span>
          <h1 style={styles.heading}>A storefront that starts from a proven build.</h1>
          <p style={styles.summary}>
            Browse a representative catalog and exercise a typed reservation mutation. Add your
            reviewed inventory and auth providers when the deployment boundary is known.
          </p>
        </div>

        {reserved ? (
          <p role="status" style={styles.notice}>
            Keyboard reserved. The request crossed Kovo&apos;s validated mutation/form boundary.
          </p>
        ) : null}

        <section aria-label="Product catalog" style={styles.productGrid}>
          <Card style={styles.product}>
            <div style={styles.productTop}>
              <div>
                <p style={styles.productName}>Aero Keyboard</p>
                <p style={styles.productMeta}>Low-profile wireless</p>
              </div>
              <Badge variant="success">In stock</Badge>
            </div>
            <p style={styles.price}>$149</p>
            <form mutation={reserveProduct} style={styles.action}>
              <input name="productId" type="hidden" value="aero-keyboard" />
              <label style={styles.field}>
                <span>Quantity</span>
                <select name="quantity" style={styles.select}>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </select>
              </label>
              <Button type="submit" variant="primary">
                Reserve
              </Button>
            </form>
          </Card>
          <Card style={styles.product}>
            <div style={styles.productTop}>
              <div>
                <p style={styles.productName}>Lumen 4K</p>
                <p style={styles.productMeta}>27-inch studio display</p>
              </div>
              <Badge variant="outline">2 left</Badge>
            </div>
            <p style={styles.price}>$259</p>
            <span style={styles.productMeta}>Free delivery this week</span>
          </Card>
          <Card style={styles.product}>
            <div style={styles.productTop}>
              <div>
                <p style={styles.productName}>Pulse Hub</p>
                <p style={styles.productMeta}>Eight-port USB-C dock</p>
              </div>
              <Badge variant="neutral">Popular</Badge>
            </div>
            <p style={styles.price}>$79</p>
            <span style={styles.productMeta}>Ships in one business day</span>
          </Card>
        </section>

        <aside style={styles.proof}>
          <strong>What this starter proves</strong>
          <span>
            One app contract, one public route, one layout, and one schema-validated mutation.
          </span>
          <span>
            No raw database, process, crypto, or local-auth fixture crosses the app graph.
          </span>
        </aside>
      </main>
    );
  },
});

export const commerceScaffoldApp = app.assemble({
  layouts: [StorefrontLayout],
  mutations: [reserveProduct],
  routes: [storefrontRoute],
});

export default commerceScaffoldApp;
