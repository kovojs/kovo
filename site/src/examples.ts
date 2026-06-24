import { fileURLToPath } from 'node:url';

import { clientHrefs } from './client/modules.js';
import type { DocsRouteContent } from './route-data.js';

// Site-local example-embed build tooling (no type declarations); reused so the
// heavy build/re-root logic lives in one place and the docs app only authors the
// presentation. See scripts/examples.mjs for the full contract.
import {
  EXAMPLES,
  buildExampleEmbed,
  exampleLiveAppHref,
  examplePagePath,
  loadExampleSources,
} from '../scripts/examples.mjs';
import { renderMarkdown } from '../scripts/md.mjs';

// Examples section: runnable Kovo apps embedded beside their authored source.
//
// CONTRACT (owned by this module):
//  - buildExampleRoutePages: the route-page data for /examples/ plus one
//    /examples/<name>/ split page per example (a sandboxed iframe when the app
//    is static-exportable or a live service URL is configured + a CSS-only
//    tabbed source viewer of the authored TSX). The authored app shell turns
//    this route-page data into route declarations at module load.
//  - exportExampleApps: a build-time hook (called by scripts/export-static.mjs
//    after the main replay) that statically exports only L0/L1-safe examples
//    into <outDir>/examples/<name>/app/ with refs re-rooted (SPEC §9.5). Dynamic
//    PGlite mutation demos render iframes from configured service URLs.

interface ExampleManifest {
  blurb: string;
  dir: string;
  embed: 'static' | 'service';
  name: string;
  serviceUrl?: string;
  serviceUrlEnv?: string;
  sources: string[];
  title: string;
}

interface ExampleSource {
  code: string;
  name: string;
}

const examples = EXAMPLES as ExampleManifest[];
const EXAMPLE_GUIDES: Record<string, string> = {
  commerce: `
## Read this example

Commerce is the largest starter-shaped app: an authenticated storefront with a product grid, cart
badge, order history, Better Auth forms, typed Drizzle reads, and a transactional add-to-cart
mutation.

| File | Why it matters |
| --- | --- |
| \`examples/commerce/src/app.tsx\` | \`createApp()\`, routes, auth wiring, document/layout facts. |
| \`examples/commerce/src/domain.ts\` | Domain names used as invalidation currency. |
| \`examples/commerce/src/schema.ts\` | Product, cart, order, and auth tables. |
| \`examples/commerce/src/db.ts\` | Drizzle/PGlite setup and seeded demo data. |
| \`examples/commerce/src/queries.ts\` | Product grid, cart count, and order-history reads. |
| \`examples/commerce/src/components/*.tsx\` | TSX regions that render those reads and forms. |
| \`examples/commerce/scripts/emit-graph.mjs\` | Graph emission used by docs/devtool workflows. |

The generated files under \`src/generated/**\` are artifacts. Inspect them when you need to verify a
lowered component, client handler, optimistic transform, or graph edge, but keep authored code in
TS/TSX. SPEC section 5.2 makes hand-authored lowered IR invalid.

Commerce sits at the auth/transaction end of the optimism spectrum. Add-to-cart writes through a
transaction, runs under the authenticated request, and lets the compiler derive the visible cart
badge update from the mutation write set and query read set.

\`\`\`sh
pnpm --filter @kovojs/example-commerce dev
pnpm --filter @kovojs/example-commerce test
pnpm --filter @kovojs/example-commerce build
pnpm --filter @kovojs/example-commerce start
pnpm --filter @kovojs/example-commerce run build:demo
node examples/commerce/scripts/emit-graph.mjs
\`\`\`
`,
  crm: `
## Read this example

CRM is a sales dashboard over Drizzle/PGlite: pipeline, contacts, and per-deal detail. It
demonstrates nested app shape, aggregate reads, parameterized routes, and a practical mix of
compiler-derived and hand-written optimistic updates.

| File | Why it matters |
| --- | --- |
| \`examples/crm/src/interactive-app.tsx\` | \`createApp()\`, shared \`layout()\`, routes, and app registration. |
| \`examples/crm/src/components/chrome.tsx\` | Shared app frame and navigation. |
| \`examples/crm/src/components/pipeline.tsx\` | Dashboard region and pipeline forms. |
| \`examples/crm/src/components/contacts.tsx\` | Contact list and creation flow. |
| \`examples/crm/src/components/deal-detail.tsx\` | Parameterized route/detail rendering. |
| \`examples/crm/src/queries.ts\` | Aggregate and detail reads over Drizzle. |
| \`examples/crm/src/mutations.ts\` | Create/move/close deal writes and optimistic behavior. |
| \`examples/crm/src/graph.test.ts\` | Assertions over the emitted app graph. |

### Dashboard pattern

Use this shape for operational apps: CRMs, admin dashboards, review queues, and internal tools where
many regions depend on related data but only some regions should refresh after each write. Keep app
chrome in a shared \`layout()\`; each route owns params, guards, page metadata, and the component that
renders the route body.

Name queries by product region: pipeline summary, grouped deals, contacts, deal detail, and any
activity stream. Aggregate queries are still first-class queries; avoid hiding them inside component
helpers because the graph needs stable names for review and \`kovo explain query\`.

Dashboards usually need a mixed optimistic policy: derive direct write/read shapes, hand-write the
product-specific summary updates, and declare \`'await-fragment'\` when server truth should win before
a region morphs.

\`\`\`sh
pnpm --filter @kovojs/example-crm dev
pnpm --filter @kovojs/example-crm test
pnpm --filter @kovojs/example-crm build
pnpm --filter @kovojs/example-crm start
pnpm --filter @kovojs/example-crm run emit-graph
pnpm --filter @kovojs/example-crm test -- src/graph.test.ts
kovo explain mutation deal/move --optimistic graph.json
\`\`\`
`,
  stackoverflow: `
## Read this example

Stack Overflow is a forum/Q&A app over Drizzle/PGlite: ranked question list, tags, users, question
detail, votes, and answer posting. It demonstrates the fully compiler-derived end of Kovo optimism.

| File | Why it matters |
| --- | --- |
| \`examples/stackoverflow/src/interactive-app.tsx\` | App declaration, layout, routes, and registered facts. |
| \`examples/stackoverflow/src/components/chrome.tsx\` | Shared app frame. |
| \`examples/stackoverflow/src/components/question-list.tsx\` | Ranked list region. |
| \`examples/stackoverflow/src/components/question-detail.tsx\` | Detail route, answers, and vote forms. |
| \`examples/stackoverflow/src/components/tags-page.tsx\` | Tag navigation pattern. |
| \`examples/stackoverflow/src/queries.ts\` | Reads for list, detail, tags, users, and session-shaped data. |
| \`examples/stackoverflow/src/mutations.ts\` | Vote, answer, and question writes. |
| \`examples/stackoverflow/src/kovo-graph.test.ts\` | Graph assertions for query/mutation coverage. |

### Forum/Q&A pattern

Use this shape for forums, knowledge bases, issue trackers, and Q&A products where list pages,
detail pages, votes, answers, tags, and per-user state all need to stay coherent. Keep the global
frame in a shared \`layout()\`, then model list, tag, user, and detail pages as separate routes.

Separate public facts from session-shaped facts. Ranked lists, tag counts, question bodies, and
answers can be shared. User vote state, draft permissions, and signed-in actions should be scoped
through explicit session-aware queries or guarded routes so the graph shows the boundary.

Forum writes often fit derived optimism: a vote or answer insert can be joined with the query read
set to predict the visible count, score, or new row. When a rank, moderation rule, or permission
check depends on server-only state, declare \`'await-fragment'\` for that query and let the response
be authoritative.

\`\`\`sh
pnpm --filter @kovojs/example-stackoverflow dev
pnpm --filter @kovojs/example-stackoverflow test
pnpm --filter @kovojs/example-stackoverflow build
pnpm --filter @kovojs/example-stackoverflow start
pnpm --filter @kovojs/example-stackoverflow run emit-graph
pnpm --filter @kovojs/example-stackoverflow test -- src/kovo-graph.test.ts
kovo explain mutation answer/create --optimistic graph.json
\`\`\`
`,
};

// scripts/examples.mjs lives at site/scripts/; the repo root is two levels up.
// (build.mjs computes the same repoRootPath this way for the embed/source loaders.)
const repoRootPath = fileURLToPath(new URL('../../', import.meta.url));

const copyHref = `${clientHrefs.code}#copy`;

export interface ExampleRoutePageData {
  activePath: string;
  content: DocsRouteContent;
  meta: { description: string; title: string };
  url: string;
}

export async function buildExampleRoutePages(): Promise<ExampleRoutePageData[]> {
  const pages: ExampleRoutePageData[] = [];
  // /examples/ index: a card grid of every example with its blurb.
  pages.push({
    activePath: '/examples/',
    content: {
      kind: 'section-index',
      section: {
        key: 'examples',
        pages: examples.map((example) => ({
          description: example.blurb,
          title: example.title,
          url: examplePagePath(example.name),
        })),
        title: 'Examples',
      },
    },
    meta: {
      description: 'Runnable Kovo example apps, embedded beside their source.',
      title: 'Examples · Kovo',
    },
    url: '/examples/',
  });

  // One split page per example. Source files are highlighted through the shared
  // markdown/Shiki pipeline (matching the previous build), with copy buttons
  // wired to the versioned code module. Static examples are exported separately
  // by exportExampleApps; dynamic examples use a service URL only when configured.
  for (const example of examples) {
    const pagePath = examplePagePath(example.name);
    const sources = (await loadExampleSources(example, { repoRootPath })) as ExampleSource[];
    const files = [];
    for (const file of sources) {
      const lang = file.name.endsWith('.tsx') ? 'tsx' : 'ts';
      const { html } = (await renderMarkdown(
        `\`\`\`${lang} title="${example.dir}/${file.name}"\n${file.code}\n\`\`\``,
        { copyHref },
      )) as { html: string };
      files.push({ html, name: file.name });
    }
    const guide = EXAMPLE_GUIDES[example.name];
    const guideHtml = guide
      ? ((await renderMarkdown(guide.trim(), { copyHref })) as { html: string }).html
      : undefined;

    pages.push({
      activePath: pagePath,
      content: {
        example: {
          appHref: exampleLiveAppHref(example),
          blurb: example.blurb,
          files,
          guideHtml,
          idBase: `${example.name}-src`,
          title: example.title,
        },
        kind: 'example',
      },
      meta: {
        description: example.blurb,
        title: `${example.title} · Examples · Kovo`,
      },
      url: pagePath,
    });
  }

  return pages;
}

/** Build-time hook: statically export each L0/L1-safe example app under
 * <outDir>/examples/<name>/app/, re-rooting its absolute refs so the iframes
 * resolve from a subdirectory on a static host (SPEC §9.5). Dynamic examples
 * with server mutation forms are served by separately deployed demo services. */
export async function exportExampleApps(outDir: string): Promise<void> {
  for (const example of examples) {
    if (example.embed !== 'static') continue;
    await buildExampleEmbed(example, { outDir, repoRootPath });
  }
}
