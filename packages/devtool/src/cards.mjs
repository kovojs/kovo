// Graph "cards" — the shared, format-neutral fact bundle for one node.
//
// SPEC §5.3: "agents consume the same artifact humans read." This module is that
// artifact, as structured data. The visual inspector renders a card to HTML; the
// MCP `kovo_explain` tool renders the same card to stable text + returns it as
// structuredContent. Both derive from one `buildCard`, so the two surfaces cannot
// drift. The `invalidates` relation is the SPEC §11.1 touch-set ⋈ §10.2 read-set
// join the compiler already proves.

/** @param {any} node @param {any} bundle */
export function buildCard(node, bundle) {
  const byId = new Map(bundle.nodes.map((n) => [n.id, n]));
  const edges = bundle.edges;
  const mutsWriting = (domains) =>
    bundle.nodes.filter(
      (n) => n.kind === 'mutation' && (n.data.writes ?? []).some((d) => domains.includes(d)),
    );
  const optStatus = (m, queryName) => {
    const o = (m.data.optimistic ?? []).find((x) => x.query === queryName);
    return o
      ? {
          status: o.status,
          reason: o.derivation?.status === 'PUNTED' ? o.derivation.reason : undefined,
        }
      : null;
  };
  const ref = (n) => ({ id: n.id, kind: n.kind, label: n.label, name: n.name });

  const card = {
    id: node.id,
    kind: node.kind,
    name: node.name,
    label: node.label,
    endpoint:
      node.kind === 'mutation'
        ? `POST /_m/${node.name}`
        : node.kind === 'query'
          ? `GET /_q/${node.name}`
          : node.kind === 'page'
            ? `GET ${node.name}`
            : undefined,
    guards: node.data.guards ?? [],
    sections: {},
    source: node.source ?? null,
  };
  const S = card.sections;

  if (node.kind === 'component') {
    const queries = edges
      .filter((e) => e.kind === 'feeds' && e.to === node.id)
      .map((e) => byId.get(e.from));
    const mutations = edges
      .filter((e) => e.kind === 'emits' && e.from === node.id)
      .map((e) => byId.get(e.to));
    card.domName = node.data.domName;
    card.fragments = node.data.fragments ?? [];
    S.queriesIn = queries.map((q) => ({
      ...ref(q),
      domains: q.data.domains ?? [],
      invalidators: mutsWriting(q.data.domains ?? []).map((m) => ({
        ...ref(m),
        optimistic: optStatus(m, q.name),
      })),
    }));
    S.mutationsOut = mutations.map((m) => ({ ...ref(m), fields: m.data.inputFields ?? [] }));
  } else if (node.kind === 'mutation') {
    const domains = node.data.writes ?? [];
    const queries = bundle.nodes.filter(
      (n) => n.kind === 'query' && (n.data.domains ?? []).some((d) => domains.includes(d)),
    );
    S.writes = domains.map((d) =>
      ref(byId.get(`domain:${d}`) ?? { id: `domain:${d}`, kind: 'domain', label: d, name: d }),
    );
    S.invalidates = queries.map((q) => ({ ...ref(q), optimistic: optStatus(node, q.name) }));
    S.inputs = node.data.inputFields ?? [];
    S.touchSites = (node.source?.touches ?? []).map((t) => ({
      via: t.via,
      domain: t.domain,
      keys: t.keys ?? null,
      site: t.site,
    }));
  } else if (node.kind === 'query') {
    const domains = node.data.domains ?? [];
    S.reads = domains.map((d) =>
      ref(byId.get(`domain:${d}`) ?? { id: `domain:${d}`, kind: 'domain', label: d, name: d }),
    );
    S.feeds = edges
      .filter((e) => e.kind === 'feeds' && e.from === node.id)
      .map((e) => ref(byId.get(e.to)));
    S.invalidatedBy = mutsWriting(domains).map((m) => ({
      ...ref(m),
      optimistic: optStatus(m, node.name),
    }));
  } else if (node.kind === 'domain') {
    S.backs = bundle.nodes
      .filter((n) => n.kind === 'query' && (n.data.domains ?? []).includes(node.name))
      .map(ref);
    S.writtenBy = bundle.nodes
      .filter((n) => n.kind === 'mutation' && (n.data.writes ?? []).includes(node.name))
      .map(ref);
  } else if (node.kind === 'agent') {
    S.tools = edges
      .filter((edge) => edge.kind === 'uses' && edge.from === node.id)
      .map((edge) => {
        const tool = byId.get(edge.to);
        return {
          ...ref(tool),
          minimumIntegrity: tool.data.minimumIntegrity,
          mutation: tool.data.mutation,
          resultIntegrity: tool.data.resultIntegrity,
        };
      });
    S.modelOperations = node.data.modelOperations ?? [];
  } else if (node.kind === 'tool') {
    S.invokes = edges
      .filter((edge) => edge.kind === 'invokes' && edge.from === node.id)
      .map((edge) => ref(byId.get(edge.to)));
    S.operations = node.data.operations ?? [];
    card.minimumIntegrity = node.data.minimumIntegrity;
    card.resultIntegrity = node.data.resultIntegrity;
  } else if (node.kind === 'task') {
    S.composition = edges
      .filter(
        (edge) =>
          edge.from === node.id &&
          (edge.kind === 'dispatches' || edge.kind === 'reads' || edge.kind === 'schedules'),
      )
      .map((edge) => ({ edge: edge.kind, ...ref(byId.get(edge.to)) }));
    card.cron = node.data.cron;
  } else if (node.kind === 'diagnostic') {
    card.diagnostic = {
      category: node.data.category,
      code: node.data.code,
      help: node.data.help,
      message: node.data.message,
      severity: node.data.severity,
      source: node.data.source,
      version: node.data.version,
    };
  } else if (node.kind === 'page') {
    card.meta = node.data.meta ?? {};
    S.renders = edges
      .filter((e) => e.kind === 'renders' && e.from === node.id)
      .map((e) => ref(byId.get(e.to)));
  }
  return card;
}

const opt = (o) =>
  o ? `[${o.status}${o.reason?.code ? `:${o.reason.code}` : ''}]` : '[no-transform]';
const list = (arr, f) => (arr && arr.length ? arr.map(f).join('\n') : '  (none)');

/** Stable, diffable text rendering — the same facts the inspector shows. */
export function cardToText(card) {
  const L = [`kovo-explain/v1`, `${card.kind.toUpperCase()} ${card.label}`];
  if (card.endpoint) L.push(`endpoint: ${card.endpoint}`);
  if (card.domName) L.push(`dom-name: ${card.domName}`);
  if (card.fragments?.length) L.push(`fragment-targets: ${card.fragments.join(', ')}`);
  if (card.guards?.length) L.push(`guards: ${card.guards.join(', ')}`);
  if (card.diagnostic) {
    const diagnostic = card.diagnostic;
    L.push(`code: ${diagnostic.code}`);
    L.push(`severity: ${diagnostic.severity}`);
    L.push(`category: ${diagnostic.category}`);
    L.push(`message: ${diagnostic.message}`);
    if (diagnostic.help) L.push(`help: ${diagnostic.help}`);
    if (diagnostic.source) {
      L.push(
        `source-span: ${diagnostic.source.file}:${diagnostic.source.start}-${diagnostic.source.end}`,
      );
    }
  }
  const S = card.sections;
  if (S.queriesIn) {
    L.push(`\nQUERIES IN (${S.queriesIn.length})`);
    L.push(
      list(
        S.queriesIn,
        (q) =>
          `  ${q.label}  reads ${q.domains.join(', ') || '—'}` +
          (q.invalidators.length
            ? `\n    refreshed by: ${q.invalidators.map((m) => `${m.label} ${opt(m.optimistic)}`).join(', ')}`
            : ''),
      ),
    );
  }
  if (S.mutationsOut) {
    L.push(`\nMUTATIONS OUT (${S.mutationsOut.length})`);
    L.push(list(S.mutationsOut, (m) => `  ${m.label}  fields: ${m.fields.join(', ') || '—'}`));
  }
  if (S.writes) {
    L.push(`\nWRITES DOMAINS (${S.writes.length})`);
    L.push(list(S.writes, (d) => `  ${d.label}`));
  }
  if (S.invalidates) {
    L.push(`\nINVALIDATES QUERIES (${S.invalidates.length})`);
    L.push(list(S.invalidates, (q) => `  ${q.label}  ${opt(q.optimistic)}`));
  }
  if (S.inputs) L.push(`\nINPUT FIELDS: ${S.inputs.join(', ') || '—'}`);
  if (S.touchSites?.length) {
    L.push(`\nWRITE SITES (touch graph)`);
    L.push(
      list(
        S.touchSites,
        (t) => `  ${t.via} → ${t.domain}${t.keys ? ` (${t.keys})` : ''}  ${t.site}`,
      ),
    );
  }
  if (S.reads) {
    L.push(`\nREADS DOMAINS: ${S.reads.map((d) => d.label).join(', ') || '—'}`);
  }
  if (S.feeds) {
    L.push(`\nFEEDS COMPONENTS (${S.feeds.length})`);
    L.push(list(S.feeds, (c) => `  ${c.label}`));
  }
  if (S.invalidatedBy) {
    L.push(`\nINVALIDATED BY (${S.invalidatedBy.length})`);
    L.push(list(S.invalidatedBy, (m) => `  ${m.label}  ${opt(m.optimistic)}`));
  }
  if (S.backs) {
    L.push(`\nBACKS QUERIES (${S.backs.length})`);
    L.push(list(S.backs, (q) => `  ${q.label}`));
  }
  if (S.writtenBy) {
    L.push(`\nWRITTEN BY (${S.writtenBy.length})`);
    L.push(list(S.writtenBy, (m) => `  ${m.label}`));
  }
  if (S.renders) {
    L.push(`\nRENDERS (${S.renders.length})`);
    L.push(list(S.renders, (c) => `  ${c.label}`));
  }
  if (S.tools) {
    L.push(`\nTOOLS (${S.tools.length})`);
    L.push(
      list(
        S.tools,
        (tool) =>
          `  ${tool.label}  mutation=${tool.mutation} minimum-integrity=${tool.minimumIntegrity} result-integrity=${tool.resultIntegrity}`,
      ),
    );
  }
  if (S.modelOperations) {
    L.push(
      `\nMODEL EFFECTS: ${S.modelOperations.map((operation) => operation.kind).join(', ') || '—'}`,
    );
  }
  if (S.invokes) {
    L.push(`\nINVOKES MUTATIONS (${S.invokes.length})`);
    L.push(list(S.invokes, (mutation) => `  ${mutation.label}`));
  }
  if (S.operations) {
    L.push(`\nTOOL EFFECTS: ${S.operations.map((operation) => operation.kind).join(', ') || '—'}`);
  }
  if (S.composition) {
    if (card.cron) L.push(`cron: ${card.cron}`);
    L.push(`\nTASK EDGES (${S.composition.length})`);
    L.push(list(S.composition, (edge) => `  ${edge.edge} → ${edge.label}`));
  }
  if (card.source) {
    L.push(`\nSOURCE  ${card.source.file}:${card.source.startLine}-${card.source.endLine}`);
    L.push(
      card.source.code
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n'),
    );
  }
  return L.join('\n');
}
