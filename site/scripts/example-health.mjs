import { EXAMPLES } from './examples.mjs';
import { pathToFileURL } from 'node:url';

/**
 * Live health gate for docs-embedded example services. The offline site smoke
 * verifies iframe wiring only; this command intentionally reaches the deployed
 * Cloud Run apps so service outages are caught by an explicit opt-in check.
 */

const ROUTES_BY_EXAMPLE = {
  commerce: ['/', '/cart'],
  crm: ['/', '/contacts'],
  stackoverflow: ['/', '/questions/q1'],
};

const ROUTE_EXPECTATIONS = {
  commerce: {
    '/': ['Aero Wireless Keyboard', 'Sign in to add items'],
    '/cart': ['Aero Wireless Keyboard', 'Cart'],
  },
  crm: {
    '/': ['Pipeline', 'Open deals'],
    '/contacts': ['Contacts', 'Add contact'],
  },
  stackoverflow: {
    '/': ['All Questions', 'Ask Question'],
    '/questions/q1': ['Accepted answer', 'Drizzle mutation'],
  },
};

const defaultTimeoutMs = Number.parseInt(process.env.KOVO_EXAMPLE_HEALTH_TIMEOUT_MS ?? '10000', 10);

function serviceUrlFor(example) {
  const override =
    example.serviceUrlEnv === undefined ? undefined : process.env[example.serviceUrlEnv];
  return (override ?? example.serviceUrl ?? '').replace(/\/+$/, '');
}

async function checkUrl(label, url, expected, options) {
  const { failures, fetchImpl, output, timeoutMs } = options;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'text/html,*/*;q=0.8', 'user-agent': 'kovo-example-health/1' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.text();
    if (!response.ok) {
      failures.push(`${label}: HTTP ${response.status}`);
      output.write(`FAIL ${label} HTTP ${response.status}\n`);
      return;
    }
    if (body.trim() === '') {
      failures.push(`${label}: empty body`);
      output.write(`FAIL ${label} empty body\n`);
      return;
    }
    const missing = expected.filter((needle) => !body.includes(needle));
    if (missing.length > 0) {
      failures.push(`${label}: missing ${missing.join(', ')}`);
      output.write(`FAIL ${label} missing ${missing.join(', ')}\n`);
      return;
    }
    output.write(`ok ${label} HTTP ${response.status}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${label}: ${message}`);
    output.write(`FAIL ${label} ${message}\n`);
  }
}

export async function checkExampleHealth({
  examples = EXAMPLES,
  fetchImpl = fetch,
  output = process.stdout,
  timeoutMs = defaultTimeoutMs,
} = {}) {
  const failures = [];

  for (const example of examples.filter((entry) => entry.embed === 'service')) {
    const routes = ROUTES_BY_EXAMPLE[example.name];
    if (!routes) {
      failures.push(`${example.name}: no health routes configured`);
      continue;
    }
    const baseUrl = serviceUrlFor(example);
    if (!baseUrl) {
      failures.push(`${example.name}: no service URL configured`);
      continue;
    }
    for (const routePath of routes) {
      const url = new URL(routePath, `${baseUrl}/`).toString();
      const expected = ROUTE_EXPECTATIONS[example.name]?.[routePath] ?? [];
      await checkUrl(`${example.name}${routePath}`, url, expected, {
        failures,
        fetchImpl,
        output,
        timeoutMs,
      });
    }
  }

  if (failures.length > 0) {
    return {
      failures,
      ok: false,
      summary: `example-health/v1\n${failures.join('\n')}\nFAIL total=${failures.length}\n`,
    };
  }
  return { failures, ok: true, summary: 'example-health/v1\nOK\n' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkExampleHealth();
  if (result.ok) {
    process.stdout.write(result.summary);
  } else {
    process.stderr.write(result.summary);
    process.exitCode = 1;
  }
}
