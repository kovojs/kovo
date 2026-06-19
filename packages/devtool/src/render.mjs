// Server-side renderer for the dataflow graph. URL-driven (SPEC §8): ?app, ?sel,
// ?q decide what renders, so the core works JS-off. Pure — takes a prebuilt bundle
// (nodes/edges with source slices) and returns HTML.
import { buildBm25, KIND_META, LANES } from './graph-model.mjs';
import { renderCode } from './highlight.mjs';

const W = 176;
const H = 56;
const COL_GAP = 78;
const COL_STEP = W + COL_GAP;
const ROW_STEP = 86;
const X0 = 40;
const TOP_PAD = 80;

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const accent = (kind) => KIND_META[kind]?.accent ?? '#888';
const glyph = (kind) => KIND_META[kind]?.glyph ?? '•';

// ---------- layout ----------
function layout(bundle) {
  const activeLanes = LANES.filter((k) => bundle.nodes.some((n) => n.kind === k));
  const lanes = activeLanes.map((k) => bundle.nodes.filter((n) => n.kind === k));

  const adj = new Map();
  for (const n of bundle.nodes) adj.set(n.id, new Set());
  for (const e of bundle.edges) {
    adj.get(e.from)?.add(e.to);
    adj.get(e.to)?.add(e.from);
  }

  const rankOf = new Map();
  const reindex = () => lanes.forEach((arr) => arr.forEach((n, i) => rankOf.set(n.id, i)));
  reindex();
  for (let sweep = 0; sweep < 6; sweep++) {
    const order = sweep % 2 ? [...lanes.keys()].reverse() : [...lanes.keys()];
    for (const li of order) {
      const arr = lanes[li];
      const bary = new Map();
      arr.forEach((n, i) => {
        const ns = [...(adj.get(n.id) ?? [])].map((x) => rankOf.get(x)).filter((x) => x != null);
        bary.set(n.id, ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : i);
      });
      arr.sort((a, b) => bary.get(a.id) - bary.get(b.id) || 0);
      reindex();
    }
  }

  const maxRows = Math.max(1, ...lanes.map((l) => l.length));
  for (let li = 0; li < lanes.length; li++) {
    const arr = lanes[li];
    const startY = TOP_PAD + ((maxRows - arr.length) * ROW_STEP) / 2;
    arr.forEach((n, i) => {
      n.lane = li;
      n.x = X0 + li * COL_STEP;
      n.y = startY + i * ROW_STEP;
    });
  }

  const width = X0 + (activeLanes.length - 1) * COL_STEP + W + 44;
  const height = Math.max(480, TOP_PAD + maxRows * ROW_STEP + 24);
  return { activeLanes, width, height };
}

// ---------- trace ----------
function trace(bundle, selId) {
  const out = new Map(),
    inc = new Map();
  for (const n of bundle.nodes) {
    out.set(n.id, []);
    inc.set(n.id, []);
  }
  for (const e of bundle.edges) {
    out.get(e.from)?.push(e);
    inc.get(e.to)?.push(e);
  }
  const nodes = new Set([selId]),
    edges = new Set();
  const walk = (cur, dir) => {
    for (const e of (dir === 'd' ? out.get(cur) : inc.get(cur)) ?? []) {
      const next = dir === 'd' ? e.to : e.from;
      edges.add(e.id);
      if (!nodes.has(next)) {
        nodes.add(next);
        walk(next, dir);
      }
    }
  };
  walk(selId, 'd');
  walk(selId, 'u');
  return { nodes, edges };
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
    cy = Math.max(sy, ey) + 64;
  return `M ${sx} ${sy} C ${sx} ${cy} ${ex} ${cy} ${ex} ${ey}`;
}

// ---------- main ----------
export function renderPage(opts) {
  const { manifest, bundle, app, sel, q, pzHref } = opts;
  const byId = new Map(bundle.nodes.map((n) => [n.id, n]));
  const { activeLanes, width, height } = layout(bundle);

  const selNode = sel ? byId.get(sel) : undefined;
  const tr = selNode ? trace(bundle, selNode.id) : null;

  let results = '';
  let hits = new Set();
  if (q && q.trim()) {
    const search = buildBm25(bundle.nodes);
    const ranked = search(q, 6);
    hits = new Set(ranked.map((r) => r.id));
    results =
      `<div class="results"><div class="results-head"><span>BM25 · ${ranked.length} matches</span><span>over ${bundle.nodes.length} graph cards</span></div>` +
      (ranked.length
        ? ranked
            .map((r) => {
              const n = byId.get(r.id);
              return (
                `<a class="result" href="?app=${app}&sel=${encodeURIComponent(n.id)}&q=${encodeURIComponent(q)}">` +
                `<span class="dot" style="background:${accent(n.kind)}"></span>` +
                `<span><b>${esc(n.label)}</b> <span class="chip">${n.kind}</span></span>` +
                `<span class="matched">${r.matched.join(' ')}</span><span class="score">${r.score.toFixed(2)}</span></a>`
              );
            })
            .join('')
        : `<div class="result"><span style="color:var(--faint)">No graph cards matched “${esc(q)}”.</span></div>`) +
      `</div>`;
  }

  const markers = activeLanes
    .map(
      (k) =>
        `<marker id="ar-${k}" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="${accent(k)}"/></marker>`,
    )
    .join('');
  const paths = bundle.edges
    .map((e) => {
      const a = byId.get(e.from),
        b = byId.get(e.to);
      if (!a || !b) return '';
      const col = accent(a.kind);
      const active = tr?.edges.has(e.id);
      const cls = ['edge', tr ? (active ? 'active animated' : 'dim') : '']
        .filter(Boolean)
        .join(' ');
      return `<path class="${cls}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" d="${edgePath(a, b)}" stroke="${col}" stroke-opacity="0.32" style="color:${col}" marker-end="url(#ar-${a.kind})"/>`;
    })
    .join('');

  const cards = bundle.nodes
    .map((n) => {
      const cls = ['node', `node--${n.kind}`];
      if (selNode) {
        if (n.id === selNode.id) cls.push('sel');
        else if (tr?.nodes.has(n.id)) cls.push('trace');
        else cls.push('dim');
      }
      if (hits.has(n.id)) cls.push('hit');
      const sub = nodeSub(n);
      const href = `?app=${app}&sel=${encodeURIComponent(n.id)}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
      return (
        `<a class="${cls.join(' ')}" data-node-id="${esc(n.id)}" href="${href}" style="left:${n.x}px;top:${n.y}px;width:${W}px;min-height:${H}px">` +
        `<span class="label"><span class="glyph">${glyph(n.kind)}</span>${esc(n.label)}</span>` +
        (sub ? `<span class="sub">${esc(sub)}</span>` : '') +
        `</a>`
      );
    })
    .join('');

  const laneHeads = activeLanes
    .map((k, i) => {
      const x = X0 + i * COL_STEP + W / 2;
      const m = KIND_META[k];
      return `<div class="lane-head" style="left:${x}px;color:${m.accent}"><span class="glyph">${m.glyph}</span><span class="name">${m.label}</span><span class="blurb">${m.blurb}</span></div>`;
    })
    .join('');

  const legend = activeLanes
    .map(
      (k) =>
        `<span class="k"><span class="sw" style="background:${accent(k)}"></span>${KIND_META[k].label}</span>`,
    )
    .join('');
  const appTabs = manifest
    .map(
      (a) =>
        `<a class="app-tab" href="?app=${a.id}" aria-current="${a.id === app}"><b>${esc(a.label)}</b><small>${esc(a.blurb)}</small></a>`,
    )
    .join('');

  return (
    (opts.css ? `<style>${opts.css}</style>` : '') +
    `<div class="app">` +
    `<header class="topbar">` +
    `<div class="brand"><span class="brand-mark"></span><span class="brand-name">Kovo</span><span class="brand-sub">Dataflow</span></div>` +
    `<form class="search" method="get" action="" role="search">` +
    `<input type="hidden" name="app" value="${app}"/>` +
    `<svg viewBox="0 0 24 24"><path d="M21 21l-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>` +
    `<input name="q" value="${esc(q ?? '')}" placeholder="Trace anything — a component, query, mutation…" autocomplete="off" spellcheck="false"/>` +
    `<kbd>BM25</kbd>${results}</form>` +
    `<div class="spacer"></div><div class="apps">${appTabs}</div></header>` +
    `<div class="stage"><div class="canvas-wrap">` +
    `<div class="canvas" data-pz-root kovo-c="dataflow-canvas" kovo-state="{}" on:visible="${pzHref}#Devtool$init" style="width:${width}px;height:${height}px">` +
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
  if (n.kind === 'mutation') return (n.data.writes ?? []).join(' · ');
  if (n.kind === 'query') return 'reads ' + (n.data.domains ?? []).join(', ');
  if (n.kind === 'component') return n.data.domName ?? '';
  if (n.kind === 'page') return 'route';
  return '';
}

// ---------- inspector ----------
const statusBadge = (s) => {
  if (!s) return `<span class="badge badge--none">no transform</span>`;
  const st = s.status;
  if (st === 'derived') return `<span class="badge badge--derived">derived</span>`;
  if (st === 'hand-written') return `<span class="badge badge--hand-written">hand-written</span>`;
  if (s.derivation?.status === 'PUNTED')
    return `<span class="badge badge--punted" title="${esc(JSON.stringify(s.derivation.reason))}">punted · ${esc(s.derivation.reason?.code ?? '')}</span>`;
  if (st === 'await-fragment')
    return `<span class="badge badge--await-fragment">await-fragment</span>`;
  return `<span class="badge badge--none">${esc(st)}</span>`;
};

function flowrow(app, n, right, q) {
  const href = `?app=${app}&sel=${encodeURIComponent(n.id)}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  return (
    `<a class="flowrow node--${n.kind}" href="${href}"><span class="dot"></span><span class="name">${esc(n.label)}` +
    (n.kind === 'component' && n.data.domName ? ` <small>${esc(n.data.domName)}</small>` : '') +
    `</span><span class="right">${right}</span></a>`
  );
}

function renderInspector(bundle, byId, sel) {
  const app = bundle.app;
  if (!sel) return overviewInspector(bundle);

  const out = bundle.edges.filter((e) => e.from === sel.id);
  const inc = bundle.edges.filter((e) => e.to === sel.id);
  const mutsWriting = (domains) =>
    bundle.nodes.filter(
      (n) => n.kind === 'mutation' && (n.data.writes ?? []).some((d) => domains.includes(d)),
    );
  const optStatus = (m, queryName) =>
    (m.data.optimistic ?? []).find((o) => o.query === queryName) ?? null;

  let body = '';
  if (sel.kind === 'component') {
    const queries = inc.filter((e) => e.kind === 'feeds').map((e) => byId.get(e.from));
    const mutations = out.filter((e) => e.kind === 'emits').map((e) => byId.get(e.to));
    body += section(
      'Queries in',
      queries.length,
      queries
        .map((qn) =>
          flowrow(
            app,
            qn,
            (qn.data.domains ?? [])
              .map((d) => `<span class="chip chip--domain">${esc(d)}</span>`)
              .join(''),
          ),
        )
        .join('') || muted('No query dependencies.'),
    );
    body += section(
      'Mutations out',
      mutations.length,
      mutations.length
        ? mutations
            .map((m) =>
              flowrow(
                app,
                m,
                (m.data.inputFields ?? [])
                  .slice(0, 4)
                  .map((f) => `<span class="chip">${esc(f)}</span>`)
                  .join(''),
              ),
            )
            .join('')
        : muted('No mutations emitted (read-only component).'),
    );
    const cov = [];
    for (const qn of queries)
      for (const m of mutsWriting(qn.data.domains ?? [])) {
        cov.push(
          `<a class="flowrow node--mutation" href="?app=${app}&sel=${encodeURIComponent(m.id)}"><span class="dot"></span><span class="name">${esc(m.label)} <small>→ ${esc(qn.label)}</small></span><span class="right">${statusBadge(optStatus(m, qn.name))}</span></a>`,
        );
      }
    body += section(
      'Refresh coverage',
      cov.length,
      cov.join('') || muted('Nothing invalidates this component’s data.'),
    );
  } else if (sel.kind === 'mutation') {
    const domains = sel.data.writes ?? [];
    const queries = bundle.nodes.filter(
      (n) => n.kind === 'query' && (n.data.domains ?? []).some((d) => domains.includes(d)),
    );
    body += section(
      'Writes domains',
      domains.length,
      `<div class="kv">${domains.map((d) => chipLink(app, byId.get(`domain:${d}`))).join('')}</div>`,
    );
    body += section(
      'Invalidates queries',
      queries.length,
      queries.map((qn) => flowrow(app, qn, statusBadge(optStatus(sel, qn.name)))).join('') ||
        muted('No queries read these domains.'),
    );
    if ((sel.data.inputFields ?? []).length)
      body += section(
        'Input fields',
        sel.data.inputFields.length,
        `<div class="kv">${sel.data.inputFields.map((f) => `<span class="chip">${esc(f)}</span>`).join('')}</div>`,
      );
    const touches = sel.source?.touches ?? [];
    if (touches.length)
      body += section(
        'Write sites (touch graph)',
        touches.length,
        touches
          .map(
            (t) =>
              `<div class="touch"><span class="via">${esc(t.via)}</span><span class="chip chip--domain">${esc(t.domain)}</span>${t.keys ? `<span class="chip">${esc(t.keys)}</span>` : ''}<span class="site">${esc(t.site?.split('/').pop())}</span></div>`,
          )
          .join(''),
      );
  } else if (sel.kind === 'query') {
    const domains = sel.data.domains ?? [];
    const consumers = bundle.edges
      .filter((e) => e.kind === 'feeds' && e.from === sel.id)
      .map((e) => byId.get(e.to));
    const invalidators = mutsWriting(domains);
    body += section(
      'Reads domains',
      domains.length,
      `<div class="kv">${domains.map((d) => chipLink(app, byId.get(`domain:${d}`))).join('')}</div>`,
    );
    body += section(
      'Feeds components',
      consumers.length,
      consumers.map((c) => flowrow(app, c, '')).join('') ||
        muted('No component consumes this query yet.'),
    );
    body += section(
      'Invalidated by',
      invalidators.length,
      invalidators.map((m) => flowrow(app, m, statusBadge(optStatus(m, sel.name)))).join('') ||
        muted('No mutation invalidates this query.'),
    );
  } else if (sel.kind === 'domain') {
    const queries = bundle.nodes.filter(
      (n) => n.kind === 'query' && (n.data.domains ?? []).includes(sel.name),
    );
    const writers = bundle.nodes.filter(
      (n) => n.kind === 'mutation' && (n.data.writes ?? []).includes(sel.name),
    );
    body += section(
      'Backs queries',
      queries.length,
      queries.map((qn) => flowrow(app, qn, '')).join('') || muted('No query reads this domain.'),
    );
    body += section(
      'Written by',
      writers.length,
      writers.map((m) => flowrow(app, m, '')).join('') || muted('No mutation writes this domain.'),
    );
  } else if (sel.kind === 'page') {
    const comps = out.filter((e) => e.kind === 'renders').map((e) => byId.get(e.to));
    if (sel.data.meta?.description)
      body += section(
        'Meta',
        0,
        `<div style="font-size:13px;color:var(--dim)">${esc(sel.data.meta.description)}</div>`,
      );
    body += section(
      'Renders',
      comps.length,
      comps.map((c) => flowrow(app, c, '')).join('') ||
        muted('No tracked component leaves on this route.'),
    );
  }

  if (sel.source?.code) body += section('Source', 0, renderCode(sel.source));

  const meta =
    sel.kind === 'component'
      ? `${esc(sel.data.domName)} · fragment ${esc((sel.data.fragments ?? [])[0] ?? '—')}`
      : sel.kind === 'mutation'
        ? `POST /_m/${esc(sel.name)}`
        : sel.kind === 'query'
          ? `GET /_q/${esc(sel.name)}`
          : sel.kind;
  const guards = sel.data.guards ?? [];
  return (
    `<div class="insp-head node--${sel.kind}"><span class="insp-kind" style="color:${accent(sel.kind)}">${glyph(sel.kind)} ${sel.kind}</span>` +
    `<div class="insp-title">${esc(sel.label)}</div><div class="insp-meta">${meta}</div>` +
    (guards.length
      ? `<div class="kv" style="margin-top:8px">${guards.map((g) => `<span class="chip">🛡 ${esc(g)}</span>`).join('')}</div>`
      : '') +
    `</div><div class="insp-body">${body}</div>`
  );
}

function overviewInspector(bundle) {
  const order = ['mutation', 'domain', 'query', 'component', 'page'];
  const counts = order
    .filter((k) => bundle.counts[k])
    .map(
      (k) =>
        `<a class="flowrow node--${k}" href="#"><span class="dot"></span><span class="name">${KIND_META[k].label}</span><span class="right"><span class="chip">${bundle.counts[k]}</span></span></a>`,
    )
    .join('');
  const opt = {};
  for (const n of bundle.nodes)
    for (const o of n.data.optimistic ?? []) {
      const key = o.derivation?.status === 'PUNTED' ? 'punted' : o.status;
      opt[key] = (opt[key] ?? 0) + 1;
    }
  const cov = Object.entries(opt)
    .map(
      ([k, v]) =>
        `${statusBadge(k === 'punted' ? { derivation: { status: 'PUNTED', reason: {} } } : { status: k })} <span class="chip">${v}</span>`,
    )
    .join(' ');
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
    ? `<a class="chip chip--domain" style="text-decoration:none" href="?app=${app}&sel=${encodeURIComponent(n.id)}">${esc(n.label)}</a>`
    : '';
