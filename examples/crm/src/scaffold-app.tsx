/** @jsxImportSource @kovojs/server */
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';
import * as style from '@kovojs/style';

import { app } from './scaffold-kovo.js';
import { advanceDeal } from './scaffold-mutations.js';

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
  metrics: {
    display: 'grid',
    gap: 12,
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    '@media (max-width: 700px)': { gridTemplateColumns: '1fr' },
  },
  metric: { display: 'grid', gap: 8 },
  metricLabel: {
    color: style.tokens.sys.color.onSurfaceVariant,
    fontSize: 13,
    margin: 0,
  },
  metricValue: {
    fontSize: 28,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 700,
    margin: 0,
  },
  board: {
    display: 'grid',
    gap: 16,
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    '@media (max-width: 800px)': { gridTemplateColumns: '1fr' },
  },
  lane: { display: 'grid', gap: 12 },
  laneTitle: {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'space-between',
  },
  deal: { display: 'grid', gap: 10 },
  dealName: { fontSize: 16, fontWeight: 650, margin: 0 },
  dealMeta: {
    color: style.tokens.sys.color.onSurfaceVariant,
    fontSize: 14,
    margin: 0,
  },
  action: {
    alignItems: 'center',
    display: 'flex',
    gap: 12,
    justifyContent: 'space-between',
  },
  notice: {
    backgroundColor: style.tokens.sys.color.secondaryContainer,
    borderRadius: style.tokens.sys.shape.cornerMedium,
    color: style.tokens.sys.color.onSecondaryContainer,
    margin: 0,
    paddingBlock: 12,
    paddingInline: 16,
  },
});

const CrmLayout = app.layout({
  access: app.publicAccess('public CRM scaffold dashboard'),
  render: (_queries, _state, { children }) => <div style={styles.shell}>{children}</div>,
});

const dashboardRoute = app.route('/', {
  access: app.publicAccess('public CRM scaffold dashboard'),
  layout: CrmLayout,
  meta: {
    description: 'A buildable Kovo CRM workflow with a typed mutation and no raw authority.',
    title: 'Atlas CRM · Kovo',
  },
  page(context) {
    const advanced = context.search.advanced === '1';
    return (
      <main style={styles.stack}>
        <div style={styles.stack}>
          <span style={styles.eyebrow}>Atlas CRM</span>
          <h1 style={styles.heading}>Pipeline, without the framework ceremony.</h1>
          <p style={styles.summary}>
            This scaffold keeps one meaningful deal workflow visible while remaining production
            buildable. Add your reviewed database and auth providers at the app boundary.
          </p>
        </div>

        {advanced ? (
          <p role="status" style={styles.notice}>
            Northstar Labs advanced to qualified. The stateless demo action completed through a
            typed Kovo mutation.
          </p>
        ) : null}

        <section aria-label="Pipeline summary" style={styles.metrics}>
          <Card style={styles.metric}>
            <p style={styles.metricLabel}>Open pipeline</p>
            <p style={styles.metricValue}>$184k</p>
          </Card>
          <Card style={styles.metric}>
            <p style={styles.metricLabel}>Weighted forecast</p>
            <p style={styles.metricValue}>$96k</p>
          </Card>
          <Card style={styles.metric}>
            <p style={styles.metricLabel}>Deals this quarter</p>
            <p style={styles.metricValue}>18</p>
          </Card>
        </section>

        <section aria-label="Sales pipeline" style={styles.board}>
          <div style={styles.lane}>
            <div style={styles.laneTitle}>
              <strong>Lead</strong>
              <Badge variant="neutral">1</Badge>
            </div>
            <Card style={styles.deal}>
              <p style={styles.dealName}>Northstar Labs</p>
              <p style={styles.dealMeta}>Platform rollout · $42,000</p>
              <form mutation={advanceDeal} style={styles.action}>
                <input name="dealId" type="hidden" value="northstar-labs" />
                <span style={styles.dealMeta}>Owner: Ada</span>
                <Button type="submit" variant="primary">
                  Qualify deal
                </Button>
              </form>
            </Card>
          </div>
          <div style={styles.lane}>
            <div style={styles.laneTitle}>
              <strong>Qualified</strong>
              <Badge variant="outline">1</Badge>
            </div>
            <Card style={styles.deal}>
              <p style={styles.dealName}>Analytical Engines</p>
              <p style={styles.dealMeta}>Expansion · $68,000</p>
              <span style={styles.dealMeta}>Next step: security review</span>
            </Card>
          </div>
          <div style={styles.lane}>
            <div style={styles.laneTitle}>
              <strong>Proposal</strong>
              <Badge variant="success">1</Badge>
            </div>
            <Card style={styles.deal}>
              <p style={styles.dealName}>Naval Systems</p>
              <p style={styles.dealMeta}>Annual renewal · $74,000</p>
              <span style={styles.dealMeta}>Decision due Friday</span>
            </Card>
          </div>
        </section>
      </main>
    );
  },
});

export const crmScaffoldApp = app.assemble({
  layouts: [CrmLayout],
  mutations: [advanceDeal],
  routes: [dashboardRoute],
});

export default crmScaffoldApp;
