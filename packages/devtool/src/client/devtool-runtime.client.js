// Progressive live replay for the dev-only runtime frame stream.
//
// Frames contain graph-routing summaries only. This module never receives or
// renders mutation input, query JSON, change keys, target identities, cookies,
// response bodies, or arbitrary HTML.
const FRAME_SCHEMA = 'kovo-devtool-runtime-frame/v1';
const MAX_RECENT = 8;
const MAX_FACTS = 64;
const MAX_BODY_BYTES = 512 * 1024;
const GRAPH_NAME = /^[A-Za-z0-9_./:@-]{1,256}$/u;

export function DevtoolRuntime$init(_event, context) {
  const root = document.querySelector('[data-runtime-panel]');
  if (!root || root.__kovoRuntimeInit) return;
  root.__kovoRuntimeInit = true;
  const href = root.getAttribute('data-runtime-stream');
  const status = root.querySelector('[data-runtime-status]');
  if (!href || typeof EventSource !== 'function') {
    if (status) status.textContent = 'stream unavailable';
    return;
  }

  if (status) status.textContent = 'connecting';
  const source = new EventSource(href);
  const recent = [];
  const onFrame = (event) => {
    let frame;
    try {
      frame = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!validRuntimeFrame(frame)) return;
    recent.push(frame);
    if (recent.length > MAX_RECENT) recent.splice(0, recent.length - MAX_RECENT);
    renderRecentRuntimeFrames(root, recent);
    applyRuntimeFrame(root.closest('.app') ?? document, frame);
    if (status) status.textContent = 'live';
  };
  source.addEventListener('frame', onFrame);
  const onOpen = () => {
    if (status) status.textContent = 'live';
  };
  const onError = () => {
    if (status) status.textContent = 'reconnecting';
  };
  source.addEventListener('open', onOpen);
  source.addEventListener('error', onError);

  const signal = context?.signal;
  const dispose = () => {
    signal?.removeEventListener('abort', dispose);
    source.removeEventListener('frame', onFrame);
    source.removeEventListener('open', onOpen);
    source.removeEventListener('error', onError);
    source.close();
    if (status) status.textContent = 'closed';
  };
  signal?.addEventListener('abort', dispose, { once: true });
  if (signal?.aborted) dispose();
}

export function applyRuntimeFrame(scope, frame) {
  if (!validRuntimeFrame(frame)) return false;
  const nodeIds = runtimeNodeIds(frame);
  const pending = frame.phase === 'pending';
  for (const node of scope.querySelectorAll('[data-node-id]')) {
    const active = nodeIds.has(node.getAttribute('data-node-id'));
    node.classList.toggle('runtime-hot', active);
    node.classList.toggle('runtime-pending', active && pending);
  }
  for (const edge of scope.querySelectorAll('path[data-from][data-to]')) {
    const active = runtimeEdgeIsActive(
      nodeIds,
      edge.getAttribute('data-from'),
      edge.getAttribute('data-to'),
    );
    edge.classList.toggle('runtime-hot', active);
    edge.classList.toggle('runtime-pending', active && pending);
  }
  return true;
}

function runtimeEdgeIsActive(nodeIds, from, to) {
  if (from === null || to === null || !nodeIds.has(from)) return false;
  return nodeIds.has(to) || from.startsWith('mutation:') || from.startsWith('query:');
}

export function renderRecentRuntimeFrames(root, frames) {
  const list = root.querySelector('[data-runtime-list]');
  if (!list) return;
  const fragment = document.createDocumentFragment();
  for (const frame of frames.slice(-MAX_RECENT).reverse()) {
    if (!validRuntimeFrame(frame)) continue;
    const row = document.createElement('li');
    row.className = `runtime-row runtime-row--${frame.phase}`;
    row.dataset.runtimeSequence = String(frame.sequence);
    const phase = document.createElement('span');
    phase.className = 'runtime-phase';
    phase.textContent = frame.phase;
    const summary = document.createElement('span');
    summary.className = 'runtime-summary';
    summary.textContent = runtimeFrameSummary(frame);
    row.append(phase, summary);
    fragment.append(row);
  }
  list.replaceChildren(fragment);
}

export function runtimeFrameSummary(frame) {
  if (!validRuntimeFrame(frame)) return 'invalid frame';
  const parts = [`#${frame.sequence}`];
  if (frame.mutation) parts.push(frame.mutation);
  if (frame.changes.length > 0) {
    parts.push(`changes ${frame.changes.map((change) => change.domain).join(', ')}`);
  }
  const queryNames = new Set([
    ...frame.targets.queryNames,
    ...frame.queries.map((query) => query.name),
  ]);
  if (queryNames.size > 0) parts.push(`queries ${[...queryNames].join(', ')}`);
  if (frame.queries.length > 0) {
    const bytes = frame.queries.reduce((sum, query) => sum + query.bytes, 0);
    parts.push(`${bytes} B values redacted`);
  }
  if (frame.status !== undefined) parts.push(`HTTP ${frame.status}`);
  if (frame.truncated || frame.targets.truncated) parts.push('truncated');
  return parts.join(' · ');
}

function runtimeNodeIds(frame) {
  const ids = new Set();
  if (frame.mutation) ids.add(`mutation:${frame.mutation}`);
  for (const change of frame.changes) ids.add(`domain:${change.domain}`);
  for (const name of frame.targets.queryNames) ids.add(`query:${name}`);
  for (const query of frame.queries) ids.add(`query:${query.name}`);
  return ids;
}

function validRuntimeFrame(frame) {
  if (
    typeof frame !== 'object' ||
    frame === null ||
    frame.schema !== FRAME_SCHEMA ||
    !graphName(frame.app) ||
    !Number.isSafeInteger(frame.sequence) ||
    frame.sequence < 1 ||
    (frame.phase !== 'pending' && frame.phase !== 'settled') ||
    (frame.mutation !== null && !graphName(frame.mutation)) ||
    (frame.status !== undefined &&
      (!Number.isSafeInteger(frame.status) || frame.status < 100 || frame.status > 599)) ||
    typeof frame.truncated !== 'boolean' ||
    !Array.isArray(frame.changes) ||
    !Array.isArray(frame.queries) ||
    frame.changes.length > MAX_FACTS ||
    frame.queries.length > MAX_FACTS ||
    typeof frame.targets !== 'object' ||
    frame.targets === null ||
    !Array.isArray(frame.targets.queryNames) ||
    frame.targets.queryNames.length > MAX_FACTS ||
    !Number.isSafeInteger(frame.targets.count) ||
    frame.targets.count < 0 ||
    frame.targets.count > MAX_FACTS ||
    typeof frame.targets.truncated !== 'boolean'
  ) {
    return false;
  }
  if (
    !frame.changes.every(
      (change) =>
        typeof change === 'object' &&
        change !== null &&
        graphName(change.domain) &&
        Number.isSafeInteger(change.keyCount) &&
        change.keyCount >= 0 &&
        change.keyCount <= MAX_FACTS,
    )
  ) {
    return false;
  }
  if (
    !frame.queries.every(
      (query) =>
        typeof query === 'object' &&
        query !== null &&
        graphName(query.name) &&
        Number.isSafeInteger(query.bytes) &&
        query.bytes >= 0 &&
        query.bytes <= MAX_BODY_BYTES &&
        typeof query.delta === 'boolean' &&
        typeof query.keyed === 'boolean' &&
        typeof query.settlesPendingWork === 'boolean' &&
        query.value === 'redacted',
    )
  ) {
    return false;
  }
  return frame.targets.queryNames.every(graphName);
}

function graphName(value) {
  return typeof value === 'string' && GRAPH_NAME.test(value);
}
