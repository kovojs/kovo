// Dev-only runtime frame summaries for the dataflow devtool.
//
// SPEC §9.1 keeps the wire legible, but legibility is not permission to duplicate
// application payloads into another debugging surface. This store therefore keeps
// only bounded graph-routing facts: mutation/query/domain names, counts, phases,
// and byte sizes. Mutation inputs, query values, target identities, dependency
// keys, change keys, cookies, headers, and response bodies are never retained.

export const RUNTIME_FRAME_SCHEMA = 'kovo-devtool-runtime-frame/v1';
export const RUNTIME_FRAME_STREAM_PATH = '/_runtime/frames';
export const RUNTIME_FRAME_DEFAULT_LIMIT = 32;
export const RUNTIME_FRAME_MAX_LIMIT = 128;
export const RUNTIME_FRAME_MAX_SUBSCRIBERS = 16;
export const RUNTIME_FRAME_MAX_BODY_BYTES = 512 * 1024;

const MAX_HEADER_BYTES = 16 * 1024;
const MAX_FACTS = 64;
const MAX_NAME_LENGTH = 256;
const MAX_APP_LENGTH = 128;
const GRAPH_NAME = /^[A-Za-z0-9_./:@-]+$/u;
const MUTATION_PATH = /^\/_m\/([^/?#]+)(?:[?#]|$)/u;
const textEncoder = new TextEncoder();

/**
 * Create one process-local, bounded store shared by capture, SSE, UI, and MCP.
 *
 * @param {{ limit?: number, maxSubscribers?: number }} [options]
 */
export function createRuntimeFrameStore(options = {}) {
  const limit = boundedInteger(
    options.limit ?? RUNTIME_FRAME_DEFAULT_LIMIT,
    1,
    RUNTIME_FRAME_MAX_LIMIT,
    'runtime frame limit',
  );
  const maxSubscribers = boundedInteger(
    options.maxSubscribers ?? RUNTIME_FRAME_MAX_SUBSCRIBERS,
    1,
    RUNTIME_FRAME_MAX_SUBSCRIBERS,
    'runtime frame subscriber limit',
  );
  const frames = [];
  const subscribers = new Set();
  let closed = false;
  let sequence = 0;

  return Object.freeze({
    get closed() {
      return closed;
    },
    get limit() {
      return limit;
    },
    close() {
      if (closed) return;
      closed = true;
      frames.length = 0;
      subscribers.clear();
    },
    recent(options = {}) {
      const app = options.app === undefined ? undefined : appName(options.app);
      const requested = boundedInteger(options.limit ?? limit, 1, limit, 'recent frame limit');
      const selected = app === undefined ? frames : frames.filter((frame) => frame.app === app);
      return Object.freeze(selected.slice(-requested));
    },
    recordRoundTrip(input) {
      if (closed) return undefined;
      const frame = runtimeFrameFromRoundTrip(input, ++sequence);
      if (frame === undefined) {
        sequence -= 1;
        return undefined;
      }
      frames.push(frame);
      if (frames.length > limit) frames.splice(0, frames.length - limit);
      const currentSubscribers = [];
      for (const subscriber of subscribers) currentSubscribers.push(subscriber);
      for (const subscriber of currentSubscribers) {
        try {
          subscriber(frame);
        } catch {
          // A debugging observer is never allowed to affect the app response path.
          subscribers.delete(subscriber);
        }
      }
      return frame;
    },
    subscribe(subscriber) {
      if (closed) throw new Error('Kovo runtime frame store is closed.');
      if (typeof subscriber !== 'function') {
        throw new TypeError('Kovo runtime frame subscriber must be a function.');
      }
      if (subscribers.size >= maxSubscribers) {
        throw new Error('Kovo runtime frame subscriber limit reached.');
      }
      subscribers.add(subscriber);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        subscribers.delete(subscriber);
      };
    },
  });
}

/**
 * Convert one enhanced round-trip phase into a redacted immutable frame.
 *
 * @param {unknown} input
 * @param {number} sequence
 */
function runtimeFrameFromRoundTrip(input, sequence) {
  if (!isPlainObject(input)) throw new TypeError('Kovo runtime frame input must be an object.');
  const app = appName(input.app);
  const phase = input.phase === 'pending' || input.phase === 'settled' ? input.phase : undefined;
  if (phase === undefined) throw new TypeError('Kovo runtime frame phase is invalid.');
  const mutation = mutationFromUrl(input.url);
  const targetFacts = targetsFromHeader(input.targetsHeader);
  const changeResult =
    phase === 'settled'
      ? changesFromHeader(input.changesHeader)
      : { changes: emptyList(), truncated: false };
  const queryResult =
    phase === 'settled'
      ? queriesFromCapture(input.queries, input.queriesTruncated === true)
      : { queries: emptyList(), truncated: false };
  const status =
    phase === 'settled' && Number.isSafeInteger(input.status) && input.status >= 100
      ? Math.min(input.status, 599)
      : undefined;

  if (
    mutation === undefined &&
    targetFacts.queryNames.length === 0 &&
    changeResult.changes.length === 0 &&
    queryResult.queries.length === 0
  ) {
    return undefined;
  }

  return deepFreeze({
    app,
    changes: changeResult.changes,
    mutation: mutation ?? null,
    phase,
    queries: queryResult.queries,
    schema: RUNTIME_FRAME_SCHEMA,
    sequence,
    status,
    targets: targetFacts,
    truncated: changeResult.truncated || queryResult.truncated,
  });
}

/**
 * Create the same-origin, no-store SSE response over a runtime frame store.
 *
 * Backpressure is coalescing: while a consumer is blocked, only the latest
 * redacted frame remains pending. The store itself remains independently bounded.
 *
 * @param {{ app: string, request: Request, store: ReturnType<typeof createRuntimeFrameStore>, limit?: number }} options
 */
export function runtimeFrameSseResponse({ app, request, store, limit }) {
  if (!(request instanceof Request)) {
    throw new TypeError('Kovo runtime frame stream requires a Request.');
  }
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed\n', {
      headers: { Allow: 'GET', 'Cache-Control': 'no-store' },
      status: 405,
    });
  }
  if (!sameOriginDebugRequest(request)) {
    return new Response('Forbidden\n', {
      headers: { 'Cache-Control': 'no-store' },
      status: 403,
    });
  }
  const selectedApp = appName(app);
  const backlogLimit = boundedInteger(
    limit ?? Math.min(12, store.limit),
    1,
    store.limit,
    'runtime frame backlog limit',
  );
  const encoder = textEncoder;
  let unsubscribe = () => {};
  let removeAbort = () => {};
  let pending;
  let controllerRef;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    removeAbort();
  };
  const enqueue = (controller, text) => {
    if (closed) return;
    try {
      controller.enqueue(encoder.encode(text));
    } catch {
      cleanup();
    }
  };
  const sendFrame = (controller, frame) => {
    enqueue(controller, `event: frame\ndata: ${JSON.stringify(frame)}\n\n`);
  };

  let stream;
  try {
    stream = new ReadableStream({
      cancel() {
        cleanup();
      },
      pull(controller) {
        if (pending !== undefined) {
          const frame = pending;
          pending = undefined;
          sendFrame(controller, frame);
        }
      },
      start(controller) {
        controllerRef = controller;
        enqueue(controller, `: ${RUNTIME_FRAME_SCHEMA}\nretry: 2000\n\n`);
        for (const frame of store.recent({ app: selectedApp, limit: backlogLimit })) {
          sendFrame(controller, frame);
        }
        unsubscribe = store.subscribe((frame) => {
          if (frame.app !== selectedApp || closed) return;
          if (controller.desiredSize !== null && controller.desiredSize <= 0) {
            pending = frame;
            return;
          }
          sendFrame(controller, frame);
        });
        const abort = () => {
          cleanup();
          try {
            controller.close();
          } catch {
            // The stream may already have been canceled by the client.
          }
        };
        request.signal.addEventListener('abort', abort, { once: true });
        removeAbort = () => request.signal.removeEventListener('abort', abort);
        if (request.signal.aborted) abort();
      },
    });
  } catch (error) {
    cleanup();
    if (String(error).includes('subscriber limit')) {
      return new Response('Runtime frame subscriber limit reached.\n', {
        headers: { 'Cache-Control': 'no-store', 'Retry-After': '2' },
        status: 503,
      });
    }
    throw error;
  }

  if (closed && controllerRef !== undefined) {
    try {
      controllerRef.close();
    } catch {
      // Already closed.
    }
  }
  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-store, private',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function sameOriginDebugRequest(request) {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site === 'cross-site') return false;
  const origin = request.headers.get('Origin');
  if (origin === null) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function targetsFromHeader(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return deepFreeze({ count: 0, queryNames: emptyList(), truncated: false });
  }
  if (value.length > MAX_HEADER_BYTES || byteLength(value) > MAX_HEADER_BYTES) {
    return deepFreeze({ count: 0, queryNames: emptyList(), truncated: true });
  }
  const entries = value.split(';');
  const queryNames = new Set();
  let count = 0;
  let truncated = false;
  for (const rawEntry of entries) {
    if (count >= MAX_FACTS) {
      truncated = true;
      break;
    }
    const entry = rawEntry.trim();
    if (!entry) continue;
    const equals = entry.indexOf('=');
    if (equals <= 0) continue;
    count += 1;
    const encodedDependencies = entry.slice(equals + 1);
    let dependencies;
    try {
      dependencies = decodeURIComponent(encodedDependencies);
    } catch {
      truncated = true;
      continue;
    }
    for (const dependency of dependencies.split(' ')) {
      if (!dependency) continue;
      const name = keyedDependencyName(dependency);
      const safe = safeGraphName(name);
      if (safe !== undefined && queryNames.size < MAX_FACTS) queryNames.add(safe);
      else if (safe !== undefined) truncated = true;
    }
  }
  return deepFreeze({
    count,
    queryNames: [...queryNames].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    truncated,
  });
}

function keyedDependencyName(value) {
  if (!value.startsWith('!')) return value;
  const delimiter = value.indexOf('!', 1);
  return delimiter > 1 ? value.slice(1, delimiter) : '';
}

function changesFromHeader(value) {
  if (value === undefined || value === '') return { changes: emptyList(), truncated: false };
  if (
    typeof value !== 'string' ||
    value.length > MAX_HEADER_BYTES ||
    byteLength(value) > MAX_HEADER_BYTES
  )
    return { changes: emptyList(), truncated: true };
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { changes: emptyList(), truncated: true };
  }
  if (!Array.isArray(parsed)) return { changes: emptyList(), truncated: true };
  const changes = [];
  let truncated = parsed.length > MAX_FACTS;
  for (let index = 0; index < parsed.length && changes.length < MAX_FACTS; index += 1) {
    const change = parsed[index];
    if (!isPlainObject(change)) {
      truncated = true;
      continue;
    }
    const domain = safeGraphName(change.domain);
    if (domain === undefined) {
      truncated = true;
      continue;
    }
    changes.push({
      domain,
      keyCount: Array.isArray(change.keys) ? Math.min(change.keys.length, MAX_FACTS) : 0,
    });
    if (Array.isArray(change.keys) && change.keys.length > MAX_FACTS) truncated = true;
  }
  return { changes: deepFreeze(changes), truncated };
}

function queriesFromCapture(value, captureTruncated) {
  if (value === undefined) return { queries: emptyList(), truncated: captureTruncated };
  if (!Array.isArray(value)) return { queries: emptyList(), truncated: true };
  const queries = [];
  let truncated = captureTruncated || value.length > MAX_FACTS;
  for (let index = 0; index < value.length && queries.length < MAX_FACTS; index += 1) {
    const query = value[index];
    if (!isPlainObject(query)) {
      truncated = true;
      continue;
    }
    const name = safeGraphName(query.name);
    if (
      name === undefined ||
      !Number.isSafeInteger(query.bytes) ||
      query.bytes < 0 ||
      query.bytes > RUNTIME_FRAME_MAX_BODY_BYTES ||
      typeof query.delta !== 'boolean' ||
      typeof query.keyed !== 'boolean' ||
      typeof query.settlesPendingWork !== 'boolean' ||
      query.value !== 'redacted'
    ) {
      truncated = true;
      continue;
    }
    queries.push({
      bytes: query.bytes,
      delta: query.delta,
      keyed: query.keyed,
      name,
      settlesPendingWork: query.settlesPendingWork,
      value: 'redacted',
    });
  }
  return { queries: deepFreeze(queries), truncated };
}

function mutationFromUrl(value) {
  if (typeof value !== 'string' || value.length > 4_096) return undefined;
  const match = MUTATION_PATH.exec(value);
  if (match === null) return undefined;
  let decoded;
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
  return safeGraphName(decoded);
}

function safeGraphName(value) {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_NAME_LENGTH &&
    GRAPH_NAME.test(value)
    ? value
    : undefined;
}

function appName(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_APP_LENGTH ||
    !GRAPH_NAME.test(value)
  ) {
    throw new TypeError('Kovo runtime frame app id is invalid.');
  }
  return value;
}

function byteLength(value) {
  return textEncoder.encode(value).byteLength;
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function isPlainObject(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function deepFreeze(value) {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function emptyList() {
  return Object.freeze([]);
}
