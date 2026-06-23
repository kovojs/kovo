import { EXAMPLES } from './examples.mjs';

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

const timeoutMs = Number.parseInt(process.env.KOVO_EXAMPLE_HEALTH_TIMEOUT_MS ?? '10000', 10);
const failures = [];

function serviceUrlFor(example) {
  const override =
    example.serviceUrlEnv === undefined ? undefined : process.env[example.serviceUrlEnv];
  return (override ?? example.serviceUrl ?? '').replace(/\/+$/, '');
}

async function checkUrl(label, url) {
  try {
    const response = await fetch(url, {
      headers: { accept: 'text/html,*/*;q=0.8', 'user-agent': 'kovo-example-health/1' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.text();
    if (!response.ok) {
      failures.push(`${label}: HTTP ${response.status}`);
      process.stdout.write(`FAIL ${label} HTTP ${response.status}\n`);
      return;
    }
    if (body.trim() === '') {
      failures.push(`${label}: empty body`);
      process.stdout.write(`FAIL ${label} empty body\n`);
      return;
    }
    process.stdout.write(`ok ${label} HTTP ${response.status}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${label}: ${message}`);
    process.stdout.write(`FAIL ${label} ${message}\n`);
  }
}

for (const example of EXAMPLES.filter((entry) => entry.embed === 'service')) {
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
    await checkUrl(`${example.name}${routePath}`, url);
  }
}

if (failures.length > 0) {
  process.stderr.write(`example-health/v1\n${failures.join('\n')}\nFAIL total=${failures.length}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('example-health/v1\nOK\n');
}
