import type { RegistryFacts } from '../packages/compiler/src/internal.js';

export interface CompilerPerfFile {
  fileName: string;
  registryFacts?: RegistryFacts;
  source: string;
}

export interface CompilerPerfCorpus {
  files: readonly CompilerPerfFile[];
  name: string;
}

export function compilerPerfCorpora(): CompilerPerfCorpus[] {
  return [
    largeComponentCorpus(),
    manySmallComponentsCorpus(),
    manyRoutesRegistriesCorpus(),
    cssHeavyComponentsCorpus(),
    heavyPrimitiveCompositionCorpus(),
    mixedRealAppCorpus(),
  ];
}

function largeComponentCorpus(): CompilerPerfCorpus {
  const blocks = Array.from({ length: 120 }, (_, index) =>
    [
      `        <section class="result result-${index}" title={catalog.title${index}} viewTransitionName={catalog.slug${index}}>`,
      `          <h2>Item <span>{catalog.name${index}}</span></h2>`,
      `          <p>Inventory {catalog.stock${index}}</p>`,
      `          <button hidden={!state.expanded${index}}>Choose</button>`,
      '        </section>',
    ].join('\n'),
  ).join('\n');

  return {
    files: [
      {
        fileName: 'perf/large/large-catalog.tsx',
        registryFacts: { queries: { catalog: 'CatalogQuery' } },
        source: `
import { component } from '@kovojs/core';

export const LargeCatalog = component({
  queries: { catalog: catalogQuery },
  state: () => ({ expanded0: false }),
  render: ({ catalog }, state) => (
    <large-catalog>
${blocks}
    </large-catalog>
  ),
});
`,
      },
    ],
    name: 'large-component',
  };
}

function manySmallComponentsCorpus(): CompilerPerfCorpus {
  return {
    files: Array.from({ length: 48 }, (_, index) => ({
      fileName: `perf/small/small-${index}.tsx`,
      registryFacts: { queries: { item: 'ItemQuery' } },
      source: `
import { component } from '@kovojs/core';

export const Small${index} = component({
  queries: { item: itemQuery },
  state: () => ({ active: false }),
  render: ({ item }, state) => (
    <small-${index}>
      <button class="toggle-${index}" hidden={!state.active}>Toggle</button>
      <span>{item.label${index}}</span>
      <p>Status {state.active ? 'active' : 'idle'}</p>
    </small-${index}>
  ),
});
`,
    })),
    name: 'many-small-components',
  };
}

function manyRoutesRegistriesCorpus(): CompilerPerfCorpus {
  const routes = Array.from({ length: 96 }, (_, index) =>
    index % 2 === 0 ? `/products/${index}/:slug` : `/checkout/${index}`,
  );

  return {
    files: Array.from({ length: 32 }, (_, index) => {
      const productRoute = `/products/${index * 2}/:slug`;
      const checkoutRoute = `/checkout/${index * 2 + 1}`;

      return {
        fileName: `perf/routes/route-card-${index}.tsx`,
        registryFacts: { routes },
        source: `
import { component } from '@kovojs/core';
import { Link } from '@kovojs/core';

export const RouteCard${index} = component({
  render: () => (
    <route-card-${index}>
      <Link to="${productRoute}" params={{ slug: 'sku-${index}' }}>Product ${index}</Link>
      <a href="${checkoutRoute}">Checkout ${index}</a>
      <form action="${checkoutRoute}" method="get"><button>Open</button></form>
    </route-card-${index}>
  ),
});
`,
      };
    }),
    name: 'many-routes-registries',
  };
}

function cssHeavyComponentsCorpus(): CompilerPerfCorpus {
  return {
    files: Array.from({ length: 16 }, (_, index) => {
      const rules = Array.from({ length: 72 }, (_, ruleIndex) =>
        [
          `    .tile-${ruleIndex} { color: rgb(${(ruleIndex * 17) % 255}, ${
            (ruleIndex * 29) % 255
          }, ${(ruleIndex * 41) % 255}); padding: ${ruleIndex % 9}px; }`,
          `    .tile-${ruleIndex}:hover { transform: translateY(-1px); }`,
        ].join('\n'),
      ).join('\n');

      return {
        fileName: `perf/css/css-panel-${index}.tsx`,
        source: `
import { component } from '@kovojs/core';

export const CssPanel${index} = component({
  css: \`
${rules}
  \`,
  render: () => (
    <css-panel-${index}>
      <div class="tile-${index}">Panel ${index}</div>
    </css-panel-${index}>
  ),
});
`,
      };
    }),
    name: 'css-heavy-components',
  };
}

function heavyPrimitiveCompositionCorpus(): CompilerPerfCorpus {
  return {
    files: Array.from({ length: 20 }, (_, index) => {
      const triggers = Array.from({ length: 12 }, (_, triggerIndex) =>
        [
          '        <Tooltip.Trigger',
          '          asChild',
          '          attrs={{',
          `            class: 'primitive primitive-${triggerIndex}',`,
          "            'data-state': 'closed',",
          `            'aria-label': 'Trigger ${index}-${triggerIndex}',`,
          "            'on:click': '/c/primitive#toggle',",
          '          }}',
          '        >',
          `          <button class="author author-${triggerIndex}" data-p-index="${triggerIndex}">Toggle ${triggerIndex}</button>`,
          '        </Tooltip.Trigger>',
        ].join('\n'),
      ).join('\n');

      return {
        fileName: `perf/primitives/primitive-stack-${index}.tsx`,
        source: `
import { component } from '@kovojs/core';

export const PrimitiveStack${index} = component({
  render: () => (
    <primitive-stack-${index}>
${triggers}
    </primitive-stack-${index}>
  ),
});
`,
      };
    }),
    name: 'heavy-primitive-composition',
  };
}

function mixedRealAppCorpus(): CompilerPerfCorpus {
  const routes = ['/dashboard', '/accounts/:id', '/accounts/:id/settings', '/reports'];

  return {
    files: Array.from({ length: 8 }, (_, index) => ({
      fileName: `perf/app/dashboard-${index}.tsx`,
      registryFacts: { queries: { account: 'AccountQuery', report: 'ReportQuery' }, routes },
      source: `
import { component } from '@kovojs/core';
import { Link } from '@kovojs/core';

export const Dashboard${index} = component({
  disableServerRefresh: ${index % 2 !== 0},
  queries: { account: accountQuery, report: reportQuery },
  state: () => ({ expanded: false }),
  css: \`
    .summary { display: grid; gap: 8px; }
    .danger { color: red; }
  \`,
  render: ({ account, report }, state) => (
    <dashboard-${index}>
      <nav><Link to="/accounts/:id" params={{ id: 'acct-${index}' }}>Account</Link></nav>
      <section class="summary" title={account.name} viewTransitionName={account.slug}>
        <h2>{account.name}</h2>
        <p>Open invoices {report.openInvoices}</p>
        <button hidden={!state.expanded}>Collapse</button>
      </section>
      <Tooltip.Trigger asChild attrs={{ class: 'primitive', 'data-state': 'closed' }}>
        <button class="danger">Archive</button>
      </Tooltip.Trigger>
    </dashboard-${index}>
  ),
});
`,
    })),
    name: 'mixed-real-app',
  };
}
