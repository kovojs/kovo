import { describe, expect, it } from 'vitest';
import { deriveAppGraph } from './app-graph.js';
import { compileRouteModule } from './scan/route-pages.js';

function verdicts(source: string): Record<string, string> {
  const routes = compileRouteModule({ fileName: 'src/routes.tsx', source });
  const graph = deriveAppGraph({ components: [], routePages: [routes] });
  return Object.fromEntries(
    (graph.graph.cacheInfluence?.entries ?? []).map((e) => [e.root, e.verdict]),
  );
}

const P = `
import { defineKovo, route, publicAccess } from '@kovojs/server';
const app = defineKovo({ appId: '00000000-0000-4000-8000-000000000000' });
`;

describe('ADVERSARIAL accidental-leak matrix (real compile pipeline)', () => {
  it('closes passing the context object into a helper (page has direct JSX)', () => {
    const v = verdicts(`${P}
function render(ctx: any): string { return ctx.request.headers.get('cookie') ?? ''; }
export const r = route('/', { access: publicAccess('x'), page: (context) => <div>{render(context)}</div> });
`);
    expect(v['document:/']).toBe('shared-cache-closed');
  });

  it('closes a same-module helper that reads process.env (secret through call graph)', () => {
    const v = verdicts(`${P}
function secretName(): string { return process.env.NAME ?? ''; }
export const r = route('/', { access: publicAccess('x'), page: () => <div>{secretName()}</div> });
`);
    expect(v['document:/']).toBe('shared-cache-closed');
  });

  it('closes a nested same-module component reading signUrl-like context alias', () => {
    const v = verdicts(`${P}
export const r = route('/', {
  access: publicAccess('x'),
  page: (context) => { const c = context; return <div>{c.params.id}{helper(c)}</div>; },
});
function helper(x: any): string { return String(x.search); }
`);
    expect(v['document:/']).toBe('shared-cache-closed');
  });

  it('closes reading an arbitrary request header via destructured request param', () => {
    const v = verdicts(`${P}
export const r = route('/', {
  access: publicAccess('x'),
  page: ({ params }, request) => <div>{request.headers.get('x-tenant')}</div>,
});
`);
    expect(v['document:/']).toBe('shared-cache-closed');
  });

  it('closes a computed context member access', () => {
    const v = verdicts(`${P}
const key = 'params';
export const r = route('/', { access: publicAccess('x'), page: (context) => <div>{(context as any)[key]}</div> });
`);
    expect(v['document:/']).toBe('shared-cache-closed');
  });

  it('closes Math.random and Date.now non-determinism', () => {
    const v = verdicts(`${P}
export const a = route('/rand', { access: publicAccess('x'), page: () => <div>{Math.random()}</div> });
export const b = route('/now', { access: publicAccess('x'), page: () => <div>{Date.now()}</div> });
`);
    expect(v['document:/rand']).toBe('shared-cache-closed');
    expect(v['document:/now']).toBe('shared-cache-closed');
  });

  it('closes reading globalThis', () => {
    const v = verdicts(`${P}
export const r = route('/', { access: publicAccess('x'), page: () => <div>{String((globalThis as any).secret)}</div> });
`);
    expect(v['document:/']).toBe('shared-cache-closed');
  });

  it('closes an object/array method not in the pure allowlist (e.g. structuredClone via call)', () => {
    const v = verdicts(`${P}
export const r = route('/', { access: publicAccess('x'), page: () => <div>{structuredClone({a:1}).a}</div> });
`);
    expect(v['document:/']).toBe('shared-cache-closed');
  });

  it('proves a genuinely pure page with params/search only', () => {
    const v = verdicts(`${P}
export const r = route('/p/:id', {
  access: publicAccess('x'),
  page: (context) => <div>{context.params.id.toUpperCase()}{String(context.search)}</div>,
});
`);
    expect(v['document:/p/:id']).toBe('public-proved');
  });
});
