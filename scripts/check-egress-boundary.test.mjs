import { describe, expect, it } from 'vitest';

import { checkEgressBoundary } from './check-egress-boundary.mjs';

const baseFiles = {
  'packages/server/src/egress.ts': `export const frameworkEgressFetch = async (input, init) => {
const dispatcher = activeUndiciFloorDispatcher();
request = egressRequestWithDispatcher(request, dispatcher);
const originBlocked = evaluateFrameworkDestinationOrigin({ host, port, protocol, policy });
const resolved = await lookupAllAddresses(host);
return globalThis.fetch(input, init);
};`,
  'packages/server/src/egress-dgram.ts': '',
  'packages/server/src/egress-undici.ts': `override dispatch() {
const originBlocked = evaluateFrameworkDestinationOrigin({ host, port, protocol, policy });
return dnsLookup(host, { all: true });
}`,
  'packages/server/src/egress-undici-runtime.ts': '',
  'packages/server/src/egress-bootstrap.ts': '',
  'packages/server/src/egress-credentials.ts': '',
  'packages/server/src/task-runner.ts': `import { frameworkEgressFetch } from './egress.js';
export const ctx = { fetch: frameworkEgressFetch };`,
  'packages/server/src/webhook.ts': `import { frameworkEgressFetch } from './egress.js';
export const ctx = { fetch: frameworkEgressFetch };`,
};

function run(files) {
  const all = { ...baseFiles, ...files };
  return checkEgressBoundary({
    repoRoot: '/repo',
    sourceFiles: Object.keys(all),
    readText: (file) => all[file] ?? '',
    exists: (file) => Object.hasOwn(all, file),
  });
}

describe('check-egress-boundary', () => {
  it('passes when runtime code uses the framework egress choke', () => {
    expect(run({}).ok).toBe(true);
  });

  it('rejects a planted direct fetch canary outside the boundary', () => {
    const result = run({
      'packages/server/src/canary.ts': `export async function leak(url) { return fetch(url); }`,
    });

    expect(result.ok).toBe(false);
    expect(result.findings.join('\n')).toContain('packages/server/src/canary.ts:1');
    expect(result.findings.join('\n')).toContain('outbound fetch must route through');
  });

  it('rejects raw http and socket primitives outside the boundary', () => {
    const result = run({
      'packages/server/src/raw.ts': `http.request(opts); https.get(url); net.createConnection(80, host); dgram.createSocket('udp4');`,
    });

    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(4);
  });

  it('rejects removal or reordering of the positive-capability guards', () => {
    expect(
      run({
        'packages/server/src/egress.ts': `export const frameworkEgressFetch = async () => {
const resolved = await lookupAllAddresses(host);
const originBlocked = evaluateFrameworkDestinationOrigin({ host, port, protocol, policy });
}`,
      }).findings.join('\n'),
    ).toContain('origin allowlist must reject before DNS');
    expect(
      run({
        'packages/server/src/task-runner.ts': 'export const ctx = { fetch: hooks.fetch };',
      }).findings.join('\n'),
    ).toContain('non-replaceable framework capability');
    expect(run({ 'packages/server/src/webhook.ts': '' }).findings.join('\n')).toContain(
      'webhook ctx.fetch must be the framework capability',
    );
  });

  it('ignores comments, quoted strings, and generated client template fetches', () => {
    const result = run({
      'packages/server/src/stringy.ts': `// fetch(url)
const a = "http.get(opts)";
const client = \`async function refresh() { await fetch('/hmr'); }\`;`,
    });

    expect(result.ok).toBe(true);
  });
});
