import { describe, expect, it } from 'vitest';

import { deriveAppGraph } from './app-graph.js';
import { compileRouteModule } from './scan/route-pages.js';

/**
 * SPEC §9.4 document cache-influence surface (plans/good-perf.md D9): every JSX-authored route
 * page contributes one `document:<path>` manifest entry. The finite document cache language is
 * fail-closed — `public-proved` requires an authored public access decision AND every per-request
 * handler staying inside the analyzed same-module closure; anything unmodeled closes the entry.
 */

function documentEntries(source: string) {
  const routes = compileRouteModule({ fileName: 'src/routes.tsx', source });
  const graph = deriveAppGraph({ components: [], routePages: [routes] });
  return graph.graph.cacheInfluence?.entries ?? [];
}

function verdictByRoot(source: string): Record<string, string> {
  return Object.fromEntries(documentEntries(source).map((entry) => [entry.root, entry.verdict]));
}

describe('document cache-influence derivation (SPEC §9.4, D9)', () => {
  it('proves a pure same-module JSX page with public access and closes credentialed shapes', () => {
    const verdicts = verdictByRoot(`
import { defineKovo, route, publicAccess } from '@kovojs/server';

const app = defineKovo({ appId: '00000000-0000-4000-8000-000000000000' });

const products = [
  { slug: 'a', name: 'Alpha', priceLabel: '$1' },
  { slug: 'b', name: 'Beta', priceLabel: '$2' },
];

function productForSlug(slug: string) {
  return products.find((entry) => entry.slug === slug) ?? products[0];
}

function Nav(): string {
  return <nav>{products.map((product) => <a href={'/product/' + product.slug}>{product.name}</a>)}</nav>;
}

function Shell({ children }: { children: unknown }): string {
  return <div class="shell"><Nav />{children}</div>;
}

export const home = route('/', {
  access: publicAccess('public catalog'),
  meta: { title: 'Home' },
  page: () => <Shell>{products.map((product) => <article>{product.name}</article>)}</Shell>,
});

export const product = route('/product/:slug', {
  access: publicAccess('public product'),
  page: (context) => {
    const { name, priceLabel } = productForSlug(context.params.slug);
    return <Shell><h1>{name}</h1><p>{priceLabel}</p></Shell>;
  },
});

export const guarded = route('/account', {
  access: [],
  page: () => <Shell>{'private'}</Shell>,
});
`);
    expect(verdicts).toEqual({
      'document:/': 'public-proved',
      'document:/account': 'shared-cache-closed',
      'document:/product/:slug': 'public-proved',
    });
  });

  it('emits canonical url-path/url-search cache-key axes on proved documents', () => {
    const entries = documentEntries(`
import { defineKovo, route, publicAccess } from '@kovojs/server';

const app = defineKovo({ appId: '00000000-0000-4000-8000-000000000000' });
export const home = route('/', {
  access: publicAccess('public'),
  page: () => <main>Home</main>,
});
`);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      authored: { posture: 'public' },
      axes: [
        { kind: 'url-path', role: 'cache-key' },
        { kind: 'url-search', role: 'cache-key' },
      ],
      closedReasons: [],
      root: 'document:/',
      surface: 'document',
      vary: [],
      verdict: 'public-proved',
    });
  });

  it('closes every credential- or identity-reaching page shape (the adversarial matrix)', () => {
    const verdicts = verdictByRoot(`
import { defineKovo, route, publicAccess } from '@kovojs/server';

const app = defineKovo({ appId: '00000000-0000-4000-8000-000000000000' });
import { ImportedCard } from './card.js';

let counter = 0;

export const cookie = route('/cookie', {
  access: publicAccess('reads the request identity'),
  page: (context, request) => <div>{request.headers.get('cookie')}</div>,
});

export const signer = route('/signed', {
  access: publicAccess('mints capability urls'),
  page: ({ signUrl }) => <div>{'x'}</div>,
});

export const ambient = route('/ambient', {
  access: publicAccess('reads process env'),
  page: () => <div>{process.env.SECRET}</div>,
});

export const clock = route('/clock', {
  access: publicAccess('renders the time'),
  page: () => <div>{Date.now()}</div>,
});

export const asyncPage = route('/async', {
  access: publicAccess('awaits at render time'),
  page: async () => <div>{'x'}</div>,
});

export const imported = route('/imported', {
  access: publicAccess('renders an imported component'),
  page: () => <ImportedCard />,
});

export const mutable = route('/mutable', {
  access: publicAccess('reads mutable module state'),
  page: () => <div>{counter}</div>,
});

export const escape = route('/escape', {
  access: publicAccess('context escapes'),
  page: (context) => <div>{JSON.stringify(context)}</div>,
});

export const noDecision = route('/no-decision', {
  page: () => <div>{'x'}</div>,
});
`);
    expect(verdicts).toEqual({
      'document:/ambient': 'shared-cache-closed',
      'document:/async': 'shared-cache-closed',
      'document:/clock': 'shared-cache-closed',
      'document:/cookie': 'shared-cache-closed',
      'document:/escape': 'shared-cache-closed',
      'document:/imported': 'shared-cache-closed',
      'document:/mutable': 'shared-cache-closed',
      'document:/no-decision': 'shared-cache-closed',
      'document:/signed': 'shared-cache-closed',
    });
  });

  it('records secret influence for signUrl and ambient environment reads', () => {
    const entries = documentEntries(`
import { defineKovo, route, publicAccess } from '@kovojs/server';

const app = defineKovo({ appId: '00000000-0000-4000-8000-000000000000' });
export const signer = route('/signed', {
  access: publicAccess('mints capability urls'),
  page: ({ signUrl, params }) => <div>{params.id}</div>,
});
`);
    expect(entries[0]?.axes).toContainEqual({ kind: 'secret', role: 'shared-cache-closed' });
    expect(entries[0]?.closedReasons).toContain('secret-influence');
  });

  it('closes guard chains as principal/session influence, machine auth as authorization', () => {
    const entries = documentEntries(`
import { defineKovo, route, guard, verifiedAccess, publicAccess } from '@kovojs/server';
const app = defineKovo({ appId: '00000000-0000-4000-8000-000000000000' });
const allow = () => true as const;
export const guarded = route('/guarded', {
  access: [guard('allow', allow)],
  page: () => <div>{'x'}</div>,
});
export const machine = route('/machine', {
  access: verifiedAccess,
  page: () => <div>{'x'}</div>,
});
`);
    const byRoot = Object.fromEntries(entries.map((entry) => [entry.root, entry]));
    expect(byRoot['document:/guarded']?.axes).toContainEqual({
      kind: 'principal',
      role: 'shared-cache-closed',
    });
    expect(byRoot['document:/guarded']?.axes).toContainEqual({
      kind: 'session',
      role: 'shared-cache-closed',
    });
    expect(byRoot['document:/machine']?.axes).toContainEqual({
      kind: 'authorization',
      role: 'shared-cache-closed',
    });
  });

  it('closes file/stream outcomes, layouts, and dynamic meta while proving static meta', () => {
    const verdicts = verdictByRoot(`
import { defineKovo, route, layout, respond, publicAccess } from '@kovojs/server';
const app = defineKovo({ appId: '00000000-0000-4000-8000-000000000000' });
import { rootedFiles } from '@kovojs/server/files';

const files = rootedFiles('../shared/images');
const appLayout = layout({});

export const image = route('/images/:name', {
  access: publicAccess('serves rooted files'),
  page: (context) => files.serve(String(context.params.name ?? ''), { contentType: 'image/webp' }),
});

export const framed = route('/framed', {
  access: publicAccess('composes a layout'),
  layout: appLayout,
  page: () => <main>{'x'}</main>,
});

export const dynamicMeta = route('/dynamic-meta', {
  access: publicAccess('meta varies at render time'),
  meta: () => ({ title: Date.now().toString() }),
  page: () => <main>{'x'}</main>,
});

export const staticMeta = route('/static-meta', {
  access: publicAccess('meta is build-constant'),
  meta: { title: 'Static' },
  page: () => <main>{'x'}</main>,
});
`);
    expect(verdicts).toEqual({
      'document:/dynamic-meta': 'shared-cache-closed',
      'document:/framed': 'shared-cache-closed',
      'document:/images/:name': 'shared-cache-closed',
      'document:/static-meta': 'public-proved',
    });
  });

  it('requires the app document configuration: no same-module defineKovo closes the entry', () => {
    const entries = documentEntries(`
import { route, publicAccess } from '@kovojs/server';
export const home = route('/', {
  access: publicAccess('public but the assembling app is not visible'),
  page: () => <main>Home</main>,
});
`);
    expect(entries[0]?.verdict).toBe('shared-cache-closed');
    expect(entries[0]?.closedReasons).toContain('unclassified-influence');
  });

  it('proves an absent or pure one-parameter renderRoute and closes a context-consuming one', () => {
    const prefix = `
import { defineKovo, route, publicAccess } from '@kovojs/server';
`;
    const routeSource = `
export const home = route('/', {
  access: publicAccess('renderRoute matrix'),
  page: () => <main>Home</main>,
});
`;
    const pure = verdictByRoot(`${prefix}
const app = defineKovo({
  appId: '00000000-0000-4000-8000-000000000000',
  renderRoute(value) {
    return typeof value === 'string' ? value : String(value ?? '');
  },
});
${routeSource}`);
    expect(pure['document:/']).toBe('public-proved');

    const contextConsuming = verdictByRoot(`${prefix}
const app = defineKovo({
  appId: '00000000-0000-4000-8000-000000000000',
  renderRoute(value, context) {
    return String(value ?? '') + String(context.request.headers.get('cookie') ?? '');
  },
});
${routeSource}`);
    expect(contextConsuming['document:/']).toBe('shared-cache-closed');

    const ambient = verdictByRoot(`${prefix}
const app = defineKovo({
  appId: '00000000-0000-4000-8000-000000000000',
  renderRoute(value) {
    return String(value ?? '') + String(process.env.SUFFIX ?? '');
  },
});
${routeSource}`);
    expect(ambient['document:/']).toBe('shared-cache-closed');
  });

  it('admits reviewed pure framework constructors (trustedUrl) as direct callees only', () => {
    const verdicts = verdictByRoot(`
import { trustedUrl } from '@kovojs/browser';
import { defineKovo, route, publicAccess } from '@kovojs/server';

const app = defineKovo({ appId: '00000000-0000-4000-8000-000000000000' });

const catalog = [{ img: '/images/a.webp', name: 'Alpha' }];

function Card({ img, name }: { img: string; name: string }): string {
  return <article><img src={trustedUrl(img, { reason: 'same-origin catalog image' })} alt={name} /></article>;
}

export const home = route('/', {
  access: publicAccess('uses the framework escape constructor'),
  page: () => <main>{catalog.map((entry) => <Card img={entry.img} name={entry.name} />)}</main>,
});

export const escaped = route('/escaped', {
  access: publicAccess('framework constructor leaves callee position'),
  page: () => <main>{[trustedUrl][0]}</main>,
});
`);
    expect(verdicts['document:/']).toBe('public-proved');
    expect(verdicts['document:/escaped']).toBe('shared-cache-closed');
  });

  it('keeps document entries out of the runtime route ABI', () => {
    const routes = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { defineKovo, route, publicAccess } from '@kovojs/server';

const app = defineKovo({ appId: '00000000-0000-4000-8000-000000000000' });
export const cookiePage = route('/cookie', {
  access: publicAccess('reads the request identity'),
  page: (context, request) => <div>{request.headers.get('cookie')}</div>,
});
`,
    });
    expect(routes.routePageFacts[0]?.cacheInfluence).toBeDefined();
    expect(routes.files[0]?.source).not.toContain('cacheInfluence');
  });
});
