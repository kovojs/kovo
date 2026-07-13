// @kovojs/devtool — DataflowGraph model (Phase 0, shared bedrock)
//
// Pure derivation over the compiler's existing `KovoExplainInput`
// (generated/graph.json). No source analysis, no fs — this only *indexes* facts
// the framework already proves (SPEC §11.1 touch-sets ⋈ §10.2 read-sets) into a
// navigable shape. Imported by both the node bundle script and the browser UI so
// the two surfaces can never diverge (SPEC §5.3 — one artifact, two renderers).
import {
  arrayAppend,
  arrayFilter,
  arrayLength,
  arrayMap,
  arrayReduce,
  arraySlice,
  arraySort,
  arrayValue,
  createMap,
  freeze,
  isSafeInteger,
  joinStrings,
  mapGet,
  mapHas,
  mapSet,
  numberLog,
  stringCharCodeAt,
  stringSlice,
} from './output-security.mjs';

/**
 * @typedef {'mutation'|'domain'|'query'|'component'|'page'} NodeKind
 * @typedef {'writes'|'backs'|'feeds'|'emits'|'renders'} EdgeKind
 */

/** Left→right dataflow lanes. A write propagates rightward to the UI. */
export const LANES = freeze(['mutation', 'domain', 'query', 'component', 'page']);

export const KIND_META = freeze({
  mutation: freeze({
    accent: '#f5a623',
    blurb: 'typed writes',
    glyph: '⚡',
    label: 'Mutations',
  }),
  domain: freeze({
    accent: '#34d399',
    blurb: 'invalidation units',
    glyph: '◆',
    label: 'Domains',
  }),
  query: freeze({ accent: '#38bdf8', blurb: 'typed reads', glyph: '◎', label: 'Queries' }),
  component: freeze({
    accent: '#a78bfa',
    blurb: 'render + handlers',
    glyph: '▢',
    label: 'Components',
  }),
  page: freeze({ accent: '#94a3b8', blurb: 'routes', glyph: '◧', label: 'Pages' }),
});

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
  const docs = arrayMap(
    nodes,
    (node) => ({ id: node.id, terms: tokenize(cardText(node)) }),
    'devtool BM25 nodes',
  );
  const N = arrayLength(docs, 'devtool BM25 documents');
  const df = createMap();
  for (let docIndex = 0; docIndex < N; docIndex += 1) {
    const terms = uniqueStrings(
      arrayValue(docs, docIndex, 'devtool BM25 documents').terms,
      'devtool BM25 document terms',
    );
    for (let termIndex = 0; termIndex < arrayLength(terms, 'devtool BM25 terms'); termIndex += 1) {
      const term = arrayValue(terms, termIndex, 'devtool BM25 terms');
      mapSet(df, term, (mapGet(df, term) ?? 0) + 1);
    }
  }
  const avgdl =
    arrayReduce(
      docs,
      (sum, document) => sum + arrayLength(document.terms, 'devtool BM25 document terms'),
      0,
      'devtool BM25 documents',
    ) / (N > 1 ? N : 1);
  const k1 = 1.5,
    b = 0.75;
  const idf = (term) => {
    const frequency = mapGet(df, term) ?? 0;
    return numberLog(1 + (N - frequency + 0.5) / (frequency + 0.5));
  };

  return function search(queryStr, limit = 8) {
    if (!isSafeInteger(limit) || limit < 0) {
      throw new TypeError('Kovo devtool BM25 limit must be a non-negative safe integer.');
    }
    const qterms = tokenize(queryStr);
    const uniqueQueryTerms = uniqueStrings(qterms, 'devtool BM25 query terms');
    const scored = arrayMap(
      docs,
      (document) => {
        const tf = createMap();
        for (
          let termIndex = 0;
          termIndex < arrayLength(document.terms, 'devtool BM25 document terms');
          termIndex += 1
        ) {
          const term = arrayValue(document.terms, termIndex, 'devtool BM25 document terms');
          mapSet(tf, term, (mapGet(tf, term) ?? 0) + 1);
        }
        let score = 0;
        const matched = [];
        for (
          let queryIndex = 0;
          queryIndex < arrayLength(uniqueQueryTerms, 'devtool BM25 query terms');
          queryIndex += 1
        ) {
          const queryTerm = arrayValue(uniqueQueryTerms, queryIndex, 'devtool BM25 query terms');
          const frequency = mapGet(tf, queryTerm) ?? 0;
          if (!frequency) continue;
          arrayAppend(matched, queryTerm, 'devtool BM25 matched terms');
          score +=
            (idf(queryTerm) * (frequency * (k1 + 1))) /
            (frequency +
              k1 *
                (1 - b + b * (arrayLength(document.terms, 'devtool BM25 document terms') / avgdl)));
        }
        return { id: document.id, matched, score };
      },
      'devtool BM25 documents',
    );
    return arraySlice(
      arraySort(
        arrayFilter(scored, (result) => result.score > 0, 'devtool BM25 scores'),
        (left, right) => right.score - left.score,
        'devtool BM25 matches',
      ),
      0,
      limit,
      'devtool BM25 sorted matches',
    );
  };
}

/** Render a node to the retrievable "card" text — its traced neighborhood. */
function cardText(n) {
  const parts = [n.kind, n.name, n.label];
  const d = n.data;
  if (n.kind === 'component') {
    appendCardParts(parts, ['component', d.domName]);
    appendCardParts(parts, d.queries ?? []);
    const forms = d.mutationForms ?? [];
    for (let index = 0; index < arrayLength(forms, 'devtool mutation forms'); index += 1) {
      const form = arrayValue(forms, index, 'devtool mutation forms');
      appendCardParts(parts, ['mutation', 'form', form.mutation]);
      appendCardParts(parts, form.fields ?? []);
    }
  } else if (n.kind === 'query') {
    appendCardParts(parts, ['query', 'read']);
    appendCardParts(parts, d.domains ?? []);
    appendCardParts(parts, d.guards ?? []);
  } else if (n.kind === 'mutation') {
    appendCardParts(parts, ['mutation', 'write']);
    appendCardParts(parts, d.writes ?? []);
    appendCardParts(parts, d.inputFields ?? []);
    appendCardParts(parts, d.guards ?? []);
    const optimistic = d.optimistic ?? [];
    for (let index = 0; index < arrayLength(optimistic, 'devtool optimistic facts'); index += 1) {
      const fact = arrayValue(optimistic, index, 'devtool optimistic facts');
      appendCardParts(parts, [fact.query, fact.status, fact.derivation?.reason?.code ?? '']);
    }
  } else if (n.kind === 'domain') {
    arrayAppend(parts, 'domain', 'devtool card parts');
  } else if (n.kind === 'page') {
    appendCardParts(parts, ['page', 'route', d.meta?.title ?? '']);
  }
  return joinStrings(
    arrayFilter(parts, (part) => typeof part === 'string' && part.length > 0, 'devtool card parts'),
    ' ',
    'devtool card text',
  );
}

function tokenize(s) {
  if (typeof s !== 'string') throw new TypeError('Kovo devtool BM25 text must be a string.');
  const terms = [];
  let current = '';
  let previousWasLowerOrDigit = false;
  const flush = () => {
    if (current.length > 1) arrayAppend(terms, current, 'devtool BM25 tokens');
    current = '';
  };
  for (let index = 0; index < s.length; index += 1) {
    const code = stringCharCodeAt(s, index);
    const uppercase = code >= 65 && code <= 90;
    const lowercase = code >= 97 && code <= 122;
    const digit = code >= 48 && code <= 57;
    if (uppercase && previousWasLowerOrDigit) flush();
    if (uppercase) current += stringSlice('abcdefghijklmnopqrstuvwxyz', code - 65, code - 64);
    else if (lowercase || digit) current += stringSlice(s, index, index + 1);
    else flush();
    previousWasLowerOrDigit = lowercase || digit;
  }
  flush();
  return terms;
}

function appendCardParts(target, values) {
  for (let index = 0; index < arrayLength(values, 'devtool card part values'); index += 1) {
    const value = arrayValue(values, index, 'devtool card part values');
    if (typeof value !== 'string') throw new TypeError('Kovo devtool card parts must be strings.');
    arrayAppend(target, value, 'devtool card parts');
  }
}

function uniqueStrings(values, label) {
  const seen = createMap();
  const unique = [];
  for (let index = 0; index < arrayLength(values, label); index += 1) {
    const value = arrayValue(values, index, label);
    if (typeof value !== 'string') throw new TypeError(`${label}[${index}] must be a string.`);
    if (mapHas(seen, value)) continue;
    mapSet(seen, value, true);
    arrayAppend(unique, value, `${label} unique values`);
  }
  return unique;
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
