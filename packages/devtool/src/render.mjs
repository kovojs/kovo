// Server-side renderer for the dataflow graph. URL-driven (SPEC §8): ?app, ?sel,
// ?q decide what renders, so the core works JS-off. Pure — takes a prebuilt bundle
// (nodes/edges with source slices) and returns HTML.
import { buildBm25, KIND_META, LANES, traceGraph } from './graph-model.mjs';
import { renderCode } from './highlight.mjs';
import {
  arrayAppend,
  arrayFilter,
  arrayFind,
  arrayIncludes,
  arrayLength,
  arrayMap,
  arrayReduce,
  arrayReverseCopy,
  arraySlice,
  arraySome,
  arraySort,
  arrayValue,
  createMap,
  createSet,
  defineOwnData,
  encodeQueryValue,
  escapeHtmlAttribute,
  escapeHtmlText,
  joinStrings,
  mapGet,
  mapSet,
  numberToFixed,
  setAdd,
  setHas,
  stringSplit,
  stringTrim,
} from './output-security.mjs';
import { snapshotRenderOptions } from './render-input.mjs';

const W = 176;
const H = 56;
const COL_GAP = 78;
const COL_STEP = W + COL_GAP;
const ROW_STEP = 86;
const X0 = 40;
const TOP_PAD = 80;

const escAttr = escapeHtmlAttribute;
const esc = escapeHtmlText;

function queryHref(params) {
  const pairs = [];
  const keys = ['app', 'sel', 'q'];
  for (let index = 0; index < arrayLength(keys, 'devtool query keys'); index += 1) {
    const key = arrayValue(keys, index, 'devtool query keys');
    const value = params[key];
    if (value !== undefined && value !== null && value !== '') {
      if (typeof value !== 'string')
        throw new TypeError(`Devtool query parameter ${key} must be text.`);
      arrayAppend(pairs, `${key}=${encodeQueryValue(value)}`, 'devtool query parameters');
    }
  }
  return `?${joinStrings(pairs, '&', 'devtool query parameters')}`;
}

const accent = (kind) => KIND_META[kind]?.accent ?? '#888';
const glyph = (kind) => KIND_META[kind]?.glyph ?? '•';

// ---------- layout ----------
function layout(bundle) {
  const activeLanes = arrayFilter(
    LANES,
    (k) => arraySome(bundle.nodes, (n) => n.kind === k, 'devtool graph nodes'),
    'devtool lane vocabulary',
  );
  const lanes = arrayMap(
    activeLanes,
    (k) => arrayFilter(bundle.nodes, (n) => n.kind === k, 'devtool graph nodes'),
    'devtool active lanes',
  );

  const adj = createMap();
  for (let index = 0; index < arrayLength(bundle.nodes, 'devtool graph nodes'); index += 1) {
    const node = arrayValue(bundle.nodes, index, 'devtool graph nodes');
    mapSet(adj, node.id, []);
  }
  for (let index = 0; index < arrayLength(bundle.edges, 'devtool graph edges'); index += 1) {
    const edge = arrayValue(bundle.edges, index, 'devtool graph edges');
    arrayAppend(mapGet(adj, edge.from), edge.to, 'devtool adjacency');
    arrayAppend(mapGet(adj, edge.to), edge.from, 'devtool adjacency');
  }

  const rankOf = createMap();
  const reindex = () => {
    for (let laneIndex = 0; laneIndex < arrayLength(lanes, 'devtool lanes'); laneIndex += 1) {
      const lane = arrayValue(lanes, laneIndex, 'devtool lanes');
      for (let nodeIndex = 0; nodeIndex < arrayLength(lane, 'devtool lane'); nodeIndex += 1) {
        mapSet(rankOf, arrayValue(lane, nodeIndex, 'devtool lane').id, nodeIndex);
      }
    }
  };
  reindex();
  for (let sweep = 0; sweep < 6; sweep++) {
    const forwardOrder = [];
    for (let index = 0; index < arrayLength(lanes, 'devtool lanes'); index += 1) {
      arrayAppend(forwardOrder, index, 'devtool lane order');
    }
    const order = sweep % 2 ? arrayReverseCopy(forwardOrder, 'devtool lane order') : forwardOrder;
    for (
      let orderIndex = 0;
      orderIndex < arrayLength(order, 'devtool lane order');
      orderIndex += 1
    ) {
      const laneIndex = arrayValue(order, orderIndex, 'devtool lane order');
      const lane = arrayValue(lanes, laneIndex, 'devtool lanes');
      const bary = createMap();
      for (let nodeIndex = 0; nodeIndex < arrayLength(lane, 'devtool lane'); nodeIndex += 1) {
        const node = arrayValue(lane, nodeIndex, 'devtool lane');
        const neighbors = mapGet(adj, node.id);
        const ranks = [];
        for (
          let neighborIndex = 0;
          neighborIndex < arrayLength(neighbors, 'devtool adjacency');
          neighborIndex += 1
        ) {
          const rank = mapGet(rankOf, arrayValue(neighbors, neighborIndex, 'devtool adjacency'));
          if (rank !== undefined) arrayAppend(ranks, rank, 'devtool neighbor ranks');
        }
        mapSet(
          bary,
          node.id,
          arrayLength(ranks, 'devtool neighbor ranks') > 0
            ? arrayReduce(ranks, (sum, rank) => sum + rank, 0, 'devtool neighbor ranks') /
                arrayLength(ranks, 'devtool neighbor ranks')
            : nodeIndex,
        );
      }
      defineOwnData(
        lanes,
        laneIndex,
        arraySort(
          lane,
          (left, right) => mapGet(bary, left.id) - mapGet(bary, right.id) || 0,
          'devtool lane',
        ),
      );
      reindex();
    }
  }

  let maxRows = 1;
  for (let laneIndex = 0; laneIndex < arrayLength(lanes, 'devtool lanes'); laneIndex += 1) {
    const size = arrayLength(arrayValue(lanes, laneIndex, 'devtool lanes'), 'devtool lane');
    if (size > maxRows) maxRows = size;
  }
  for (let laneIndex = 0; laneIndex < arrayLength(lanes, 'devtool lanes'); laneIndex += 1) {
    const lane = arrayValue(lanes, laneIndex, 'devtool lanes');
    const startY = TOP_PAD + ((maxRows - arrayLength(lane, 'devtool lane')) * ROW_STEP) / 2;
    for (let nodeIndex = 0; nodeIndex < arrayLength(lane, 'devtool lane'); nodeIndex += 1) {
      const node = arrayValue(lane, nodeIndex, 'devtool lane');
      node.lane = laneIndex;
      node.x = X0 + laneIndex * COL_STEP;
      node.y = startY + nodeIndex * ROW_STEP;
    }
  }

  const width = X0 + (arrayLength(activeLanes, 'devtool active lanes') - 1) * COL_STEP + W + 44;
  const calculatedHeight = TOP_PAD + maxRows * ROW_STEP + 24;
  const height = calculatedHeight > 480 ? calculatedHeight : 480;
  return { activeLanes, width, height };
}

// ---------- trace ----------
function trace(bundle, selId) {
  return traceGraph(bundle.nodes, bundle.edges, selId);
}

function edgePath(a, b) {
  const forward = (a.lane ?? 0) <= (b.lane ?? 0);
  if (forward) {
    const sx = a.x + W,
      sy = a.y + H / 2,
      ex = b.x,
      ey = b.y + H / 2,
      c = COL_GAP * 0.5;
    return `M ${sx} ${sy} C ${sx + c} ${sy} ${ex - c} ${ey} ${ex} ${ey}`;
  }
  const sx = a.x + W / 2,
    sy = a.y + H,
    ex = b.x + W / 2,
    ey = b.y + H,
    cy = (sy > ey ? sy : ey) + 64;
  return `M ${sx} ${sy} C ${sx} ${cy} ${ex} ${cy} ${ex} ${ey}`;
}

// ---------- main ----------
export function renderPage(opts) {
  const { manifest, bundle, app, sel, q, pzHref } = snapshotRenderOptions(opts);
  const byId = createMap();
  for (let index = 0; index < arrayLength(bundle.nodes, 'devtool graph nodes'); index += 1) {
    const node = arrayValue(bundle.nodes, index, 'devtool graph nodes');
    mapSet(byId, node.id, node);
  }
  const { activeLanes, width, height } = layout(bundle);

  const selNode = sel ? mapGet(byId, sel) : undefined;
  const tr = selNode ? trace(bundle, selNode.id) : null;

  let results = '';
  let hits = createSet();
  if (q && stringTrim(q)) {
    const search = buildBm25(bundle.nodes);
    const ranked = search(q, 6);
    hits = createSet();
    for (let index = 0; index < arrayLength(ranked, 'devtool search results'); index += 1) {
      setAdd(hits, arrayValue(ranked, index, 'devtool search results').id);
    }
    results =
      `<div class="results"><div class="results-head"><span>BM25 · ${ranked.length} matches</span><span>over ${bundle.nodes.length} graph cards</span></div>` +
      (ranked.length
        ? joinStrings(
            arrayMap(
              ranked,
              (r) => {
                const n = mapGet(byId, r.id);
                return (
                  `<a class="result" href="${escAttr(queryHref({ app, sel: n.id, q }))}">` +
                  `<span class="dot" style="background:${escAttr(accent(n.kind))}"></span>` +
                  `<span><b>${esc(n.label)}</b> <span class="chip">${esc(n.kind)}</span></span>` +
                  `<span class="matched">${esc(joinStrings(r.matched, ' ', 'devtool matched terms'))}</span><span class="score">${esc(numberToFixed(r.score, 2))}</span></a>`
                );
              },
              'devtool search results',
            ),
            '',
            'devtool rendered search results',
          )
        : `<div class="result"><span style="color:var(--faint)">No graph cards matched “${esc(q)}”.</span></div>`) +
      `</div>`;
  }

  const markers = joinStrings(
    arrayMap(
      activeLanes,
      (k) =>
        `<marker id="ar-${escAttr(k)}" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="${escAttr(accent(k))}"/></marker>`,
      'devtool active lanes',
    ),
    '',
    'devtool SVG markers',
  );
  const paths = joinStrings(
    arrayMap(
      bundle.edges,
      (e) => {
        const a = mapGet(byId, e.from),
          b = mapGet(byId, e.to);
        if (!a || !b) return '';
        const col = accent(a.kind);
        const active = tr ? setHas(tr.edges, e.id) : false;
        const cls = joinStrings(
          arrayFilter(
            ['edge', tr ? (active ? 'active animated' : 'dim') : ''],
            (value) => value !== '',
          ),
          ' ',
        );
        return `<path class="${escAttr(cls)}" data-from="${escAttr(e.from)}" data-to="${escAttr(e.to)}" d="${escAttr(edgePath(a, b))}" stroke="${escAttr(col)}" stroke-opacity="0.32" style="color:${escAttr(col)}" marker-end="url(#ar-${escAttr(a.kind)})"/>`;
      },
      'devtool graph edges',
    ),
    '',
    'devtool SVG paths',
  );

  const cards = joinStrings(
    arrayMap(
      bundle.nodes,
      (n) => {
        const cls = ['node', `node--${n.kind}`];
        if (selNode) {
          if (n.id === selNode.id) arrayAppend(cls, 'sel', 'devtool node classes');
          else if (tr && setHas(tr.nodes, n.id)) arrayAppend(cls, 'trace', 'devtool node classes');
          else arrayAppend(cls, 'dim', 'devtool node classes');
        }
        if (setHas(hits, n.id)) arrayAppend(cls, 'hit', 'devtool node classes');
        const sub = nodeSub(n);
        const href = queryHref({ app, sel: n.id, q });
        return (
          `<a class="${escAttr(joinStrings(cls, ' ', 'devtool node classes'))}" data-node-id="${escAttr(n.id)}" href="${escAttr(href)}" style="left:${escAttr(n.x)}px;top:${escAttr(n.y)}px;width:${W}px;min-height:${H}px">` +
          `<span class="label"><span class="glyph">${esc(glyph(n.kind))}</span>${esc(n.label)}</span>` +
          (sub ? `<span class="sub">${esc(sub)}</span>` : '') +
          `</a>`
        );
      },
      'devtool graph nodes',
    ),
    '',
    'devtool node cards',
  );

  const laneHeads = joinStrings(
    arrayMap(
      activeLanes,
      (k, i) => {
        const x = X0 + i * COL_STEP + W / 2;
        const m = KIND_META[k];
        return `<div class="lane-head" style="left:${escAttr(x)}px;color:${escAttr(m.accent)}"><span class="glyph">${esc(m.glyph)}</span><span class="name">${esc(m.label)}</span><span class="blurb">${esc(m.blurb)}</span></div>`;
      },
      'devtool active lanes',
    ),
    '',
    'devtool lane headings',
  );

  const legend = joinStrings(
    arrayMap(
      activeLanes,
      (k) =>
        `<span class="k"><span class="sw" style="background:${escAttr(accent(k))}"></span>${esc(KIND_META[k].label)}</span>`,
      'devtool active lanes',
    ),
    '',
    'devtool legend',
  );
  const appTabs = joinStrings(
    arrayMap(
      manifest,
      (a) =>
        `<a class="app-tab" href="${escAttr(queryHref({ app: a.id }))}" aria-current="${escAttr(a.id === app ? 'true' : 'false')}"><b>${esc(a.label)}</b><small>${esc(a.blurb)}</small></a>`,
      'devtool manifest',
    ),
    '',
    'devtool app tabs',
  );

  return (
    `<div class="app">` +
    `<header class="topbar">` +
    `<div class="brand"><span class="brand-mark"></span><span class="brand-name">Kovo</span><span class="brand-sub">Dataflow</span></div>` +
    `<form class="search" method="get" action="" role="search">` +
    `<input type="hidden" name="app" value="${escAttr(app)}"/>` +
    `<svg viewBox="0 0 24 24"><path d="M21 21l-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>` +
    `<input name="q" value="${escAttr(q ?? '')}" placeholder="Trace anything — a component, query, mutation…" autocomplete="off" spellcheck="false"/>` +
    `<kbd>BM25</kbd>${results}</form>` +
    `<div class="spacer"></div><div class="apps">${appTabs}</div></header>` +
    `<div class="stage"><div class="canvas-wrap">` +
    `<div class="canvas" data-pz-root kovo-c="dataflow-canvas" kovo-state="{}" on:visible="${escAttr(pzHref)}#Devtool$init" style="width:${escAttr(width)}px;height:${escAttr(height)}px">` +
    `<div class="pz" data-pz><div class="lane-headers">${laneHeads}</div>` +
    `<svg class="edges" width="${width}" height="${height}"><defs>${markers}</defs>${paths}</svg>${cards}</div></div>` +
    (selNode
      ? ''
      : `<div class="hint">Select a <b>component</b> to trace its <b>queries in</b> and <b>mutations out</b> · scroll to zoom · drag to pan</div>`) +
    `<div class="legend">${legend}</div>` +
    `<div class="zoom"><button type="button" data-zoom="out" title="Zoom out (−)">−</button><button type="button" data-zoom="fit" title="Fit (0)">⤢</button><button type="button" data-zoom="in" title="Zoom in (+)">+</button></div>` +
    `</div><aside class="inspector">${renderInspector(bundle, byId, selNode)}</aside></div></div>`
  );
}

function nodeSub(n) {
  if (n.kind === 'mutation') return joinStrings(n.data.writes, ' · ', 'devtool writes');
  if (n.kind === 'query')
    return 'reads ' + joinStrings(n.data.domains, ', ', 'devtool query domains');
  if (n.kind === 'component') return n.data.domName ?? '';
  if (n.kind === 'page') return 'route';
  return '';
}

function fileLeaf(path) {
  const parts = stringSplit(path, '/');
  const length = arrayLength(parts, 'devtool source path');
  return length === 0 ? '' : arrayValue(parts, length - 1, 'devtool source path');
}

// ---------- inspector ----------
const statusBadge = (s) => {
  if (!s) return `<span class="badge badge--none">no transform</span>`;
  const st = s.status;
  if (st === 'derived') return `<span class="badge badge--derived">derived</span>`;
  if (st === 'hand-written') return `<span class="badge badge--hand-written">hand-written</span>`;
  if (s.derivation?.status === 'PUNTED')
    return `<span class="badge badge--punted" title="${escAttr(puntReasonTitle(s.derivation.reason))}">punted · ${esc(s.derivation.reason?.code ?? '')}</span>`;
  if (st === 'await-fragment')
    return `<span class="badge badge--await-fragment">await-fragment</span>`;
  return `<span class="badge badge--none">${esc(st)}</span>`;
};

function puntReasonTitle(reason) {
  if (!reason) return 'PUNTED';
  const parts = [`PUNTED code=${reason.code}`];
  const fields = ['site', 'field', 'expr', 'column', 'shape', 'table', 'detail'];
  for (let index = 0; index < arrayLength(fields, 'devtool punt-reason fields'); index += 1) {
    const field = arrayValue(fields, index, 'devtool punt-reason fields');
    if (reason[field]) arrayAppend(parts, `${field}=${reason[field]}`, 'devtool punt reason');
  }
  const columns = reason.columns ?? [];
  if (arrayLength(columns, 'devtool punt-reason columns')) {
    arrayAppend(
      parts,
      `columns=${joinStrings(columns, ',', 'devtool punt-reason columns')}`,
      'devtool punt reason',
    );
  }
  return joinStrings(parts, '; ', 'devtool punt reason');
}

function flowrow(app, n, right, q) {
  const href = queryHref({ app, sel: n.id, q });
  return (
    `<a class="flowrow node--${escAttr(n.kind)}" href="${escAttr(href)}"><span class="dot"></span><span class="name">${esc(n.label)}` +
    (n.kind === 'component' && n.data.domName ? ` <small>${esc(n.data.domName)}</small>` : '') +
    `</span><span class="right">${right}</span></a>`
  );
}

function renderInspector(bundle, byId, sel) {
  const app = bundle.app;
  if (!sel) return overviewInspector(bundle);

  const out = arrayFilter(bundle.edges, (e) => e.from === sel.id, 'devtool graph edges');
  const inc = arrayFilter(bundle.edges, (e) => e.to === sel.id, 'devtool graph edges');
  const mutsWriting = (domains) =>
    arrayFilter(
      bundle.nodes,
      (n) =>
        n.kind === 'mutation' &&
        arraySome(
          n.data.writes,
          (domain) => arrayIncludes(domains, domain, 'devtool target domains'),
          'devtool mutation writes',
        ),
      'devtool graph nodes',
    );
  const optStatus = (m, queryName) =>
    arrayFind(m.data.optimistic, (o) => o.query === queryName, 'devtool optimistic facts') ?? null;

  let body = '';
  if (sel.kind === 'component') {
    const queries = arrayMap(
      arrayFilter(inc, (e) => e.kind === 'feeds', 'devtool incoming edges'),
      (e) => mapGet(byId, e.from),
      'devtool query edges',
    );
    const mutations = arrayMap(
      arrayFilter(out, (e) => e.kind === 'emits', 'devtool outgoing edges'),
      (e) => mapGet(byId, e.to),
      'devtool mutation edges',
    );
    body += section(
      'Queries in',
      arrayLength(queries, 'devtool component queries'),
      joinStrings(
        arrayMap(
          queries,
          (qn) =>
            flowrow(
              app,
              qn,
              joinStrings(
                arrayMap(
                  qn.data.domains,
                  (d) => `<span class="chip chip--domain">${esc(d)}</span>`,
                  'devtool query domains',
                ),
                '',
                'devtool domain chips',
              ),
            ),
          'devtool component queries',
        ),
        '',
        'devtool component query rows',
      ) || muted('No query dependencies.'),
    );
    body += section(
      'Mutations out',
      arrayLength(mutations, 'devtool component mutations'),
      arrayLength(mutations, 'devtool component mutations')
        ? joinStrings(
            arrayMap(
              mutations,
              (m) =>
                flowrow(
                  app,
                  m,
                  joinStrings(
                    arrayMap(
                      arraySlice(m.data.inputFields, 0, 4, 'devtool mutation input fields'),
                      (f) => `<span class="chip">${esc(f)}</span>`,
                      'devtool visible input fields',
                    ),
                    '',
                    'devtool input chips',
                  ),
                ),
              'devtool component mutations',
            ),
            '',
            'devtool component mutation rows',
          )
        : muted('No mutations emitted (read-only component).'),
    );
    const cov = [];
    for (
      let queryIndex = 0;
      queryIndex < arrayLength(queries, 'devtool component queries');
      queryIndex += 1
    ) {
      const qn = arrayValue(queries, queryIndex, 'devtool component queries');
      const writers = mutsWriting(qn.data.domains);
      for (
        let writerIndex = 0;
        writerIndex < arrayLength(writers, 'devtool query writers');
        writerIndex += 1
      ) {
        const mutation = arrayValue(writers, writerIndex, 'devtool query writers');
        arrayAppend(
          cov,
          `<a class="flowrow node--mutation" href="${escAttr(queryHref({ app, sel: mutation.id }))}"><span class="dot"></span><span class="name">${esc(mutation.label)} <small>→ ${esc(qn.label)}</small></span><span class="right">${statusBadge(optStatus(mutation, qn.name))}</span></a>`,
          'devtool refresh coverage',
        );
      }
    }
    body += section(
      'Refresh coverage',
      arrayLength(cov, 'devtool refresh coverage'),
      joinStrings(cov, '', 'devtool refresh coverage') ||
        muted('Nothing invalidates this component’s data.'),
    );
  } else if (sel.kind === 'mutation') {
    const domains = sel.data.writes;
    const queries = arrayFilter(
      bundle.nodes,
      (n) =>
        n.kind === 'query' &&
        arraySome(
          n.data.domains,
          (domain) => arrayIncludes(domains, domain, 'devtool mutation domains'),
          'devtool query domains',
        ),
      'devtool graph nodes',
    );
    body += section(
      'Writes domains',
      arrayLength(domains, 'devtool mutation domains'),
      `<div class="kv">${joinStrings(
        arrayMap(
          domains,
          (d) => chipLink(app, mapGet(byId, `domain:${d}`)),
          'devtool mutation domains',
        ),
        '',
        'devtool domain links',
      )}</div>`,
    );
    body += section(
      'Invalidates queries',
      arrayLength(queries, 'devtool invalidated queries'),
      joinStrings(
        arrayMap(
          queries,
          (qn) => flowrow(app, qn, statusBadge(optStatus(sel, qn.name))),
          'devtool invalidated queries',
        ),
        '',
        'devtool invalidated query rows',
      ) || muted('No queries read these domains.'),
    );
    if (arrayLength(sel.data.inputFields, 'devtool mutation input fields'))
      body += section(
        'Input fields',
        arrayLength(sel.data.inputFields, 'devtool mutation input fields'),
        `<div class="kv">${joinStrings(
          arrayMap(
            sel.data.inputFields,
            (f) => `<span class="chip">${esc(f)}</span>`,
            'devtool mutation input fields',
          ),
          '',
          'devtool input field chips',
        )}</div>`,
      );
    const touches = sel.source?.touches ?? [];
    if (arrayLength(touches, 'devtool touch sites'))
      body += section(
        'Write sites (touch graph)',
        arrayLength(touches, 'devtool touch sites'),
        joinStrings(
          arrayMap(
            touches,
            (t) =>
              `<div class="touch"><span class="via">${esc(t.via)}</span><span class="chip chip--domain">${esc(t.domain)}</span>${t.keys ? `<span class="chip">${esc(t.keys)}</span>` : ''}<span class="site">${esc(fileLeaf(t.site))}</span></div>`,
            'devtool touch sites',
          ),
          '',
          'devtool touch rows',
        ),
      );
  } else if (sel.kind === 'query') {
    const domains = sel.data.domains;
    const consumers = arrayMap(
      arrayFilter(
        bundle.edges,
        (e) => e.kind === 'feeds' && e.from === sel.id,
        'devtool graph edges',
      ),
      (e) => mapGet(byId, e.to),
      'devtool consumer edges',
    );
    const invalidators = mutsWriting(domains);
    body += section(
      'Reads domains',
      arrayLength(domains, 'devtool query domains'),
      `<div class="kv">${joinStrings(
        arrayMap(
          domains,
          (d) => chipLink(app, mapGet(byId, `domain:${d}`)),
          'devtool query domains',
        ),
        '',
        'devtool domain links',
      )}</div>`,
    );
    body += section(
      'Feeds components',
      arrayLength(consumers, 'devtool query consumers'),
      joinStrings(
        arrayMap(consumers, (c) => flowrow(app, c, ''), 'devtool query consumers'),
        '',
        'devtool consumer rows',
      ) || muted('No component consumes this query yet.'),
    );
    body += section(
      'Invalidated by',
      arrayLength(invalidators, 'devtool query invalidators'),
      joinStrings(
        arrayMap(
          invalidators,
          (m) => flowrow(app, m, statusBadge(optStatus(m, sel.name))),
          'devtool query invalidators',
        ),
        '',
        'devtool invalidator rows',
      ) || muted('No mutation invalidates this query.'),
    );
  } else if (sel.kind === 'domain') {
    const queries = arrayFilter(
      bundle.nodes,
      (n) => n.kind === 'query' && arrayIncludes(n.data.domains, sel.name, 'devtool query domains'),
      'devtool graph nodes',
    );
    const writers = arrayFilter(
      bundle.nodes,
      (n) =>
        n.kind === 'mutation' && arrayIncludes(n.data.writes, sel.name, 'devtool mutation writes'),
      'devtool graph nodes',
    );
    body += section(
      'Backs queries',
      arrayLength(queries, 'devtool domain queries'),
      joinStrings(
        arrayMap(queries, (qn) => flowrow(app, qn, ''), 'devtool domain queries'),
        '',
        'devtool domain query rows',
      ) || muted('No query reads this domain.'),
    );
    body += section(
      'Written by',
      arrayLength(writers, 'devtool domain writers'),
      joinStrings(
        arrayMap(writers, (m) => flowrow(app, m, ''), 'devtool domain writers'),
        '',
        'devtool domain writer rows',
      ) || muted('No mutation writes this domain.'),
    );
  } else if (sel.kind === 'page') {
    const comps = arrayMap(
      arrayFilter(out, (e) => e.kind === 'renders', 'devtool outgoing edges'),
      (e) => mapGet(byId, e.to),
      'devtool page component edges',
    );
    if (sel.data.meta?.description)
      body += section(
        'Meta',
        0,
        `<div style="font-size:13px;color:var(--dim)">${esc(sel.data.meta.description)}</div>`,
      );
    body += section(
      'Renders',
      arrayLength(comps, 'devtool page components'),
      joinStrings(
        arrayMap(comps, (c) => flowrow(app, c, ''), 'devtool page components'),
        '',
        'devtool page component rows',
      ) || muted('No tracked component leaves on this route.'),
    );
  }

  if (sel.source?.code) body += section('Source', 0, renderCode(sel.source));

  const meta =
    sel.kind === 'component'
      ? `${sel.data.domName} · fragment ${arrayLength(sel.data.fragments, 'devtool fragments') ? arrayValue(sel.data.fragments, 0, 'devtool fragments') : '—'}`
      : sel.kind === 'mutation'
        ? `POST /_m/${sel.name}`
        : sel.kind === 'query'
          ? `GET /_q/${sel.name}`
          : sel.kind;
  const guards = sel.data.guards;
  return (
    `<div class="insp-head node--${escAttr(sel.kind)}"><span class="insp-kind" style="color:${escAttr(accent(sel.kind))}">${esc(glyph(sel.kind))} ${esc(sel.kind)}</span>` +
    `<div class="insp-title">${esc(sel.label)}</div><div class="insp-meta">${esc(meta)}</div>` +
    (arrayLength(guards, 'devtool guards')
      ? `<div class="kv" style="margin-top:8px">${joinStrings(
          arrayMap(
            guards,
            (guard) => `<span class="chip">🛡 ${esc(guard)}</span>`,
            'devtool guards',
          ),
          '',
          'devtool guard chips',
        )}</div>`
      : '') +
    `</div><div class="insp-body">${body}</div>`
  );
}

function overviewInspector(bundle) {
  const order = ['mutation', 'domain', 'query', 'component', 'page'];
  const counts = joinStrings(
    arrayMap(
      arrayFilter(order, (k) => bundle.counts[k] > 0, 'devtool overview order'),
      (k) =>
        `<a class="flowrow node--${escAttr(k)}" href="#"><span class="dot"></span><span class="name">${esc(KIND_META[k].label)}</span><span class="right"><span class="chip">${bundle.counts[k]}</span></span></a>`,
      'devtool visible overview kinds',
    ),
    '',
    'devtool overview rows',
  );
  const opt = createMap();
  for (
    let nodeIndex = 0;
    nodeIndex < arrayLength(bundle.nodes, 'devtool graph nodes');
    nodeIndex += 1
  ) {
    const node = arrayValue(bundle.nodes, nodeIndex, 'devtool graph nodes');
    for (
      let optimisticIndex = 0;
      optimisticIndex < arrayLength(node.data.optimistic, 'devtool optimistic facts');
      optimisticIndex += 1
    ) {
      const optimistic = arrayValue(
        node.data.optimistic,
        optimisticIndex,
        'devtool optimistic facts',
      );
      const key = optimistic.derivation?.status === 'PUNTED' ? 'punted' : optimistic.status;
      mapSet(opt, key, (mapGet(opt, key) ?? 0) + 1);
    }
  }
  const coverageKinds = ['derived', 'hand-written', 'await-fragment', 'UNHANDLED', 'punted'];
  const cov = joinStrings(
    arrayMap(
      arrayFilter(coverageKinds, (kind) => mapGet(opt, kind) !== undefined),
      (kind) =>
        `${statusBadge(kind === 'punted' ? { derivation: { status: 'PUNTED', reason: { code: '' } } } : { status: kind })} <span class="chip">${mapGet(opt, kind)}</span>`,
      'devtool optimistic coverage kinds',
    ),
    ' ',
    'devtool optimistic coverage badges',
  );
  return (
    `<div class="insp-head"><span class="insp-kind" style="color:var(--dim)">◫ overview</span>` +
    `<div class="insp-title">${esc(bundle.label)}</div><div class="insp-meta">${bundle.nodes.length} nodes · ${bundle.edges.length} edges · derived from generated/graph.json</div></div>` +
    `<div class="insp-body">` +
    section('Graph', 0, counts) +
    (cov
      ? section(
          'Optimistic coverage (SPEC §10.6)',
          0,
          `<div class="kv" style="align-items:center">${cov}</div>`,
        )
      : '') +
    section(
      'How to read this',
      0,
      `<div style="font-size:13px;line-height:1.6;color:var(--dim)">Data flows left → right: a <b style="color:var(--mutation)">mutation</b> writes <b style="color:var(--domain)">domains</b>, which back <b style="color:var(--query)">queries</b>, which feed <b style="color:var(--component)">components</b>. The under-arc is a component <b>emitting</b> a mutation — the feedback loop. Click any node to trace it. This is the same graph the MCP <code style="font-family:var(--mono);color:var(--teal)">kovo_explain</code> tool returns to an agent.</div>`,
    ) +
    `</div>`
  );
}

const section = (title, count, inner) =>
  `<div class="section"><h3>${esc(title)}${count ? `<span class="count">${count}</span>` : ''}</h3>${inner}</div>`;
const muted = (t) => `<div style="font-size:13px;color:var(--faint)">${esc(t)}</div>`;
const chipLink = (app, n) =>
  n
    ? `<a class="chip chip--domain" style="text-decoration:none" href="${escAttr(queryHref({ app, sel: n.id }))}">${esc(n.label)}</a>`
    : '';
