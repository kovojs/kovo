// @kovojs/devtool — DataflowGraph model (Phase 0, shared bedrock)
//
// Pure derivation over the compiler's existing `KovoExplainInput`
// (generated/graph.json). No source analysis, no fs — this only *indexes* facts
// the framework already proves (SPEC §11.1 touch-sets ⋈ §10.2 read-sets) into a
// navigable shape. Imported by both the node bundle script and the browser UI so
// the two surfaces can never diverge (SPEC §5.3 — one artifact, two renderers).

/**
 * @typedef {'mutation'|'domain'|'query'|'component'|'page'} NodeKind
 * @typedef {'writes'|'backs'|'feeds'|'emits'|'renders'} EdgeKind
 */

/** Left→right dataflow lanes. A write propagates rightward to the UI. */
export const LANES = ['mutation', 'domain', 'query', 'component', 'page'];

export const KIND_META = {
  mutation: { label: 'Mutations', accent: '#f5a623', glyph: '⚡', blurb: 'typed writes' },
  domain: { label: 'Domains', accent: '#34d399', glyph: '◆', blurb: 'invalidation units' },
  query: { label: 'Queries', accent: '#38bdf8', glyph: '◎', blurb: 'typed reads' },
  component: { label: 'Components', accent: '#a78bfa', glyph: '▢', blurb: 'render + handlers' },
  page: { label: 'Pages', accent: '#94a3b8', glyph: '◧', blurb: 'routes' },
};

const id = (kind, name) => `${kind}:${name}`;

/**
 * Build the traversable dataflow graph from a raw KovoExplainInput object.
 * @param {any} raw parsed generated/graph.json
 * @returns {{nodes: any[], edges: any[], byId: Record<string, any>, index: any}}
 */
export function buildDataflowGraph(raw) {
  /** @type {Map<string, any>} */
  const nodes = new Map();
  const edges = [];

  const ensure = (kind, name, label, data = {}) => {
    const nid = id(kind, name);
    if (!nodes.has(nid)) {
      nodes.set(nid, { id: nid, kind, name, label: label ?? name, data });
    } else {
      Object.assign(nodes.get(nid).data, data);
    }
    return nodes.get(nid);
  };

  const link = (from, to, kind, data = {}) => {
    if (!from || !to) return;
    edges.push({ id: `${from.id}->${to.id}:${kind}`, from: from.id, to: to.id, kind, data });
  };

  // --- domains (union of every mention) ---
  const domainNode = (d) => ensure('domain', d, d);

  // --- mutations ---
  const optByMutation = groupBy(raw.optimistic ?? [], (o) => o.mutation);
  for (const m of raw.mutations ?? []) {
    const writes = m.writes ?? m.invalidates ?? [];
    const node = ensure('mutation', m.key, m.key, {
      guards: m.guards ?? [],
      writes,
      invalidates: m.invalidates ?? writes,
      inputFields: m.inputFields ?? [],
      session: m.session,
      optimistic: optByMutation.get(m.key) ?? [],
      touch: raw.touchGraph?.[m.key] ?? findTouchByDomains(raw.touchGraph, writes),
    });
    for (const d of writes) link(node, domainNode(d), 'writes');
  }

  // --- queries (query → backing domains) ---
  for (const q of raw.queries ?? []) {
    const node = ensure('query', q.query, q.query, {
      domains: q.domains ?? [],
      guards: q.guards ?? [],
    });
    for (const d of q.domains ?? []) link(domainNode(d), node, 'backs');
  }

  // --- components (queries in, mutations out via forms) ---
  for (const c of raw.components ?? []) {
    const label = c.exportName ?? leaf(c.name);
    const node = ensure('component', c.name, label, {
      domName: c.domName,
      exportName: c.exportName,
      queries: c.queries ?? [],
      fragments: c.fragments ?? [],
      mutationForms: c.mutationForms ?? [],
      handlers: c.handlers ?? [],
    });
    for (const qn of c.queries ?? []) {
      const qnode = nodes.get(id('query', qn));
      if (qnode) link(qnode, node, 'feeds'); // query → component (data in)
    }
    for (const mf of c.mutationForms ?? []) {
      const mnode = nodes.get(id('mutation', mf.mutation));
      if (mnode) link(node, mnode, 'emits', { slot: mf.slot, fields: mf.fields }); // component → mutation (action out)
    }
  }

  // --- pages (renders components, loads queries) ---
  for (const p of raw.pages ?? []) {
    const node = ensure('page', p.route, p.route, {
      meta: p.meta,
      prefetch: p.prefetch,
      guards: p.guards ?? [],
      layouts: p.layouts ?? [],
    });
    const compExports = [];
    for (const seg of p.navigationSegments ?? [])
      for (const c of seg.components ?? []) compExports.push(c);
    for (const exp of compExports) {
      const match = [...nodes.values()].find(
        (n) => n.kind === 'component' && (n.data.exportName === exp || n.label === exp),
      );
      if (match) link(node, match, 'renders');
    }
  }

  const byId = Object.fromEntries(nodes);
  const list = [...nodes.values()];

  // --- reverse indices: the traversal the user asked for ---
  const index = buildIndex(list, edges, byId);

  return { nodes: list, edges, byId, index };
}

function buildIndex(nodes, edges, byId) {
  const out = new Map(); // id -> edges leaving
  const inc = new Map(); // id -> edges entering
  for (const n of nodes) {
    out.set(n.id, []);
    inc.set(n.id, []);
  }
  for (const e of edges) {
    out.get(e.from)?.push(e);
    inc.get(e.to)?.push(e);
  }

  /** queries-in for a component (the `feeds` edges) + their backing domains + mutations that invalidate them. */
  const componentInflow = (cid) => {
    const queries = (inc.get(cid) ?? []).filter((e) => e.kind === 'feeds').map((e) => byId[e.from]);
    const detail = queries.map((q) => {
      const domains = (inc.get(q.id) ?? [])
        .filter((e) => e.kind === 'backs')
        .map((e) => byId[e.from]);
      const invalidators = nodes
        .filter(
          (n) => n.kind === 'mutation' && n.data.writes.some((d) => q.data.domains.includes(d)),
        )
        .map((m) => ({ mutation: m, status: optStatus(m, q.name) }));
      return { query: q, domains, invalidators };
    });
    return detail;
  };

  /** mutations-out for a component (forms) + each mutation's full downstream effect. */
  const componentOutflow = (cid) => {
    const mutations = (out.get(cid) ?? [])
      .filter((e) => e.kind === 'emits')
      .map((e) => byId[e.from === cid ? e.to : e.from]);
    return mutations.map((m) => ({ mutation: m, effects: mutationEffects(m) }));
  };

  /** every query a mutation invalidates and the components that read it. */
  const mutationEffects = (m) => {
    const queries = nodes.filter(
      (n) => n.kind === 'query' && n.data.domains.some((d) => m.data.writes.includes(d)),
    );
    return queries.map((q) => ({
      query: q,
      status: optStatus(m, q.name),
      components: (out.get(q.id) ?? []).filter((e) => e.kind === 'feeds').map((e) => byId[e.to]),
    }));
  };

  function optStatus(m, queryName) {
    const o = (m.data.optimistic ?? []).find((x) => x.query === queryName);
    return o ? { status: o.status, derivation: o.derivation } : null;
  }

  /** all node ids reachable along the dataflow when one node is selected (for highlight). */
  const traceFrom = (nid) => {
    const set = new Set([nid]);
    const edgeSet = new Set();
    const walk = (cur, dir) => {
      const list = dir === 'down' ? out.get(cur) : inc.get(cur);
      for (const e of list ?? []) {
        const next = dir === 'down' ? e.to : e.from;
        edgeSet.add(e.id);
        if (!set.has(next)) {
          set.add(next);
          walk(next, dir);
        }
      }
    };
    walk(nid, 'down');
    walk(nid, 'up');
    return { nodes: set, edges: edgeSet };
  };

  return { out, inc, componentInflow, componentOutflow, mutationEffects, optStatus, traceFrom };
}

// ---------- BM25 retrieval (the MCP tool's ranking, also powers UI search) ----------
// Deterministic, explainable lexical ranking over node "cards". SPEC values
// stable/diffable/legible output, so BM25 (reproducible, matched-terms auditable)
// fits where an embedding model would not.

export function buildBm25(nodes) {
  const docs = nodes.map((n) => ({ id: n.id, terms: tokenize(cardText(n)) }));
  const N = docs.length;
  const df = new Map();
  for (const d of docs) for (const t of new Set(d.terms)) df.set(t, (df.get(t) ?? 0) + 1);
  const avgdl = docs.reduce((s, d) => s + d.terms.length, 0) / Math.max(1, N);
  const k1 = 1.5,
    b = 0.75;
  const idf = (t) => Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));

  return function search(queryStr, limit = 8) {
    const qterms = tokenize(queryStr);
    const scored = docs.map((d) => {
      const tf = new Map();
      for (const t of d.terms) tf.set(t, (tf.get(t) ?? 0) + 1);
      let score = 0;
      const matched = [];
      for (const qt of new Set(qterms)) {
        const f = tf.get(qt) ?? 0;
        if (!f) continue;
        matched.push(qt);
        score += (idf(qt) * (f * (k1 + 1))) / (f + k1 * (1 - b + b * (d.terms.length / avgdl)));
      }
      return { id: d.id, score, matched };
    });
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  };
}

/** Render a node to the retrievable "card" text — its traced neighborhood. */
function cardText(n) {
  const parts = [n.kind, n.name, n.label];
  const d = n.data;
  if (n.kind === 'component') {
    parts.push('component', d.domName, ...(d.queries ?? []));
    for (const mf of d.mutationForms ?? [])
      parts.push('mutation', 'form', mf.mutation, ...(mf.fields ?? []));
  } else if (n.kind === 'query') {
    parts.push('query', 'read', ...(d.domains ?? []), ...(d.guards ?? []));
  } else if (n.kind === 'mutation') {
    parts.push(
      'mutation',
      'write',
      ...(d.writes ?? []),
      ...(d.inputFields ?? []),
      ...(d.guards ?? []),
    );
    for (const o of d.optimistic ?? [])
      parts.push(o.query, o.status, o.derivation?.reason?.code ?? '');
  } else if (n.kind === 'domain') {
    parts.push('domain');
  } else if (n.kind === 'page') {
    parts.push('page', 'route', d.meta?.title ?? '');
  }
  return parts.filter(Boolean).join(' ');
}

function tokenize(s) {
  return String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase split
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

// ---------- helpers ----------
function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}
function leaf(path) {
  return String(path).split('/').pop();
}
function findTouchByDomains(touchGraph, domains) {
  if (!touchGraph) return null;
  for (const [, entry] of Object.entries(touchGraph)) {
    if ((entry.touches ?? []).some((t) => domains.includes(t.domain))) return entry;
  }
  return null;
}
