import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_CENSUS_FILE,
  DEVELOPMENT_MANIFEST_FILE,
  evaluateRuntimeTierDoorParity,
  PRODUCTION_MANIFEST_FILE,
} from './check-runtime-tier-door-parity.mjs';

const repoRoot = process.cwd();

describe('runtime tier door parity gate', () => {
  it('accepts the versioned prod/dev manifests and shared capability census', () => {
    expect(evaluate()).toEqual([]);
  });

  it('fails when a production obligation loses its dev verdict', () => {
    expect(
      evaluate(({ development }) => {
        development.doors.find((door) => door.id === 'dev.http.request-shell').prodMapping.covers =
          ['request-target-bounded'];
      }),
    ).toContain(
      'prod.http.request-shell: production obligation access-policy-enforced has no dev verdict',
    );
  });

  it('rejects equivalent or stronger labels that do not match their obligation relation', () => {
    expect(
      evaluate(({ development }) => {
        development.doors.find((door) => door.id === 'dev.http.request-shell').prodMapping.verdict =
          'equivalent';
      }),
    ).toContain(
      'dev.http.request-shell: equivalent mapping must carry exactly the production obligations',
    );

    expect(
      evaluate(({ development, production }) => {
        const dev = development.doors.find((door) => door.id === 'dev.http.request-shell');
        const prod = production.doors.find((door) => door.id === 'prod.http.request-shell');
        dev.obligations = [...prod.obligations];
      }),
    ).toContain(
      'dev.http.request-shell: stronger mapping requires at least one additional dev obligation',
    );
  });

  it('requires authenticated source, module-graph, refresh, and websocket dev-only doors', () => {
    const findings = evaluate(({ development }) => {
      const source = development.doors.find((door) => door.id === 'dev.http.source-env');
      source.authentication.required = false;
      source.authentication.mechanisms = [];
      source.obligations = source.obligations.filter(
        (obligation) => obligation !== 'boot-session-authenticated',
      );
      source.exposure = source.exposure.filter((exposure) => exposure !== 'exact-host');

      const websocket = development.doors.find((door) => door.id === 'dev.websocket.hmr');
      websocket.authentication.mechanisms = ['vite-websocket-token-cookie'];
    });
    expect(findings).toEqual(
      expect.arrayContaining([
        'dev.http.source-env: dev-only source/HMR doors require authentication',
        'dev.http.source-env: dev-only door is missing boot-session-authenticated',
        'dev.http.source-env: missing exact-host exposure',
        'dev.http.source-env: dev-only door must use the shared Vite boot-token cookie',
        "dev.websocket.hmr: HMR websocket must retain Vite's independent query token",
      ]),
    );
  });

  it('makes audited exceptions exact named review rows instead of free-form labels', () => {
    expect(
      evaluate(({ development }) => {
        const mapping = development.doors.find(
          (door) => door.id === 'dev.http.request-shell',
        ).prodMapping;
        mapping.verdict = 'audited-exception';
        mapping.exceptionId = 'missing-review';
      }),
    ).toContain(
      'dev.http.request-shell: audited-exception mapping lacks its exact named review row',
    );
  });

  it('rejects stale capability-census and implementation-source references', () => {
    expect(
      evaluate(({ development }) => {
        development.doors.find(
          (door) => door.id === 'dev.http.request-shell',
        ).capabilityCensusDoorRefs = ['missing-door'];
      }),
    ).toContain('dev.http.request-shell: unknown capability census door missing-door');

    expect(
      evaluate(({ development }) => {
        development.doors.find((door) => door.id === 'dev.http.source-env').owner =
          'missingDevHostOwner';
      }),
    ).toContain(
      'dev.http.source-env: source packages/cli/src/commands/dev-host-door.ts does not contain owner missingDevHostOwner',
    );
  });

  it('pins the real HTTP/websocket door wiring and C13 oracle', () => {
    const doorSource = readText('packages/cli/src/commands/dev-host-door.ts');
    expect(
      evaluate(undefined, {
        'packages/cli/src/commands/dev-host-door.ts': doorSource.replace(
          "rawListeners('upgrade')",
          "listeners('upgrade')",
        ),
      }),
    ).toContain(
      "packages/cli/src/commands/dev-host-door.ts: missing dev-host pin rawListeners('upgrade')",
    );
  });
});

function evaluate(mutate, overrides = {}) {
  const production = readJson(PRODUCTION_MANIFEST_FILE);
  const development = readJson(DEVELOPMENT_MANIFEST_FILE);
  const census = readJson(CAPABILITY_CENSUS_FILE);
  mutate?.({ census, development, production });
  return evaluateRuntimeTierDoorParity({
    census,
    development,
    production,
    readText(file) {
      return Object.hasOwn(overrides, file) ? overrides[file] : readText(file);
    },
  });
}

function readJson(file) {
  return JSON.parse(readText(file));
}

function readText(file) {
  return readFileSync(path.join(repoRoot, file), 'utf8');
}
