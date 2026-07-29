import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertGeneratedNodeRetentionConfig,
  cloudRunJourneyPlan,
  cloudRunServiceName,
  dockerfileWithPackedTarballs,
  G11_CLOUD_RUN_PROOF_SCHEMA,
  G11_CLOUD_RUN_RETENTION_HOURS,
  G11_CLOUD_RUN_SWEEP_SCHEMA,
  packedCreatorArguments,
  probePublicCloudRun,
  runtimeEnvironmentDocument,
  selectRetentionSweepActions,
  verifyPublicCloudRunJourney,
} from './g11-cloud-run-journey.mjs';

const SOURCE_SHA = 'a'.repeat(40);

test('derives one version-addressed Cloud Run service and a buffered retention horizon', () => {
  assert.equal(cloudRunServiceName('123456789', '2'), 'kovo-g11-123456789-2');
  assert.throws(() => cloudRunServiceName('../bad', '1'), /run id must contain digits/u);

  const plan = cloudRunJourneyPlan({
    runAttempt: '2',
    runId: '123456789',
    sourceSha: SOURCE_SHA,
    startedAtEpochSeconds: 1_000,
  });
  assert.equal(plan.service, 'kovo-g11-123456789-2');
  assert.equal(plan.retention.hours, G11_CLOUD_RUN_RETENTION_HOURS);
  assert.equal(plan.retention.strategy, 'version-addressed-cloud-run-service');
  assert.equal(plan.retentionUntilEpochSeconds, 1_000 + 26 * 60 * 60);
});

test('pins packed creation to SQLite, the Node preset, and the exact 24-hour assertion', () => {
  const args = packedCreatorArguments('/tmp/kovo-g11-app');
  assert.deepEqual(args, [
    '/tmp/kovo-g11-app',
    '--name',
    'kovo-g11-cloud-run',
    '--disable-git',
    '--experimental-sqlite',
    '--no-install',
    '--sqlite',
    '--deployment',
    'node',
    '--retention',
    'retained-24h',
  ]);
  const config = [
    "import { defineConfig, node } from '@kovojs/server/build';",
    'export default defineConfig({',
    '  preset: node({',
    '    retention: {',
    '      hours: 24,',
    "      immutableClientModules: 'retained',",
    "      priorTokenQueryReads: 'retained',",
    '    },',
    '  }),',
    '});',
  ].join('\n');
  assert.doesNotThrow(() => assertGeneratedNodeRetentionConfig(config));
  assert.throws(
    () => assertGeneratedNodeRetentionConfig(config.replace('hours: 24', 'hours: 23')),
    /exact Node retention posture/u,
  );
});

test('adapts only the generated Dockerfile lockfile seam for packed tarballs', () => {
  const generated = [
    'FROM node:24-alpine@sha256:abc',
    'COPY --chown=node:node package.json ./',
    'COPY --chown=node:node package-lock.json* npm-shrinkwrap.json* pnpm-lock.yaml* yarn.lock* ./',
    'RUN corepack pnpm install --prod --frozen-lockfile --ignore-scripts',
    'COPY --chown=node:node . .',
    '',
  ].join('\n');
  const adapted = dockerfileWithPackedTarballs(generated);
  assert.match(
    adapted,
    /COPY --chown=node:node \.kovo-deploy-packages \.\/\.kovo-deploy-packages\nRUN/u,
  );
  assert.match(
    adapted,
    /RUN corepack pnpm install --prod --frozen-lockfile --ignore-scripts\nRUN corepack pnpm rebuild better-sqlite3\nCOPY --chown=node:node \. \./u,
  );
  assert.equal(
    adapted
      .replace(/COPY --chown=node:node \.kovo-deploy-packages .*\n/u, '')
      .replace('RUN corepack pnpm rebuild better-sqlite3\n', ''),
    generated,
  );
  assert.throws(
    () => dockerfileWithPackedTarballs('FROM scratch\n'),
    /reviewed lockfile\/source anchors/u,
  );
});

test('writes a production runtime environment without accepting weak or non-HTTPS authority', () => {
  const secret = 's'.repeat(48);
  const document = runtimeEnvironmentDocument('https://kovo-g11.example.run.app', {
    KOVO_G11_ATTESTATION_DEPLOYMENT_ID: 'deployment:g11:123',
    KOVO_G11_ATTESTATION_SECRET: `a${secret}`,
    KOVO_G11_BETTER_AUTH_SECRET: `b${secret}`,
    KOVO_G11_CSRF_SECRET: `c${secret}`,
  });
  assert.match(document, /BETTER_AUTH_URL: "https:\/\/kovo-g11\.example\.run\.app"/u);
  assert.match(document, /KOVO_NODE_TRUSTED_PROXY: "1"/u);
  assert.match(document, /NODE_ENV: "production"/u);
  assert.doesNotMatch(document, /KOVO_DEMO_PASSWORD/u);
  assert.throws(
    () =>
      runtimeEnvironmentDocument('http://kovo-g11.example.run.app', {
        KOVO_G11_ATTESTATION_DEPLOYMENT_ID: 'deployment:g11:123',
        KOVO_G11_ATTESTATION_SECRET: `a${secret}`,
        KOVO_G11_BETTER_AUTH_SECRET: `b${secret}`,
        KOVO_G11_CSRF_SECRET: `c${secret}`,
      }),
    /canonical HTTPS origin/u,
  );
});

test('probes the public health, document, build-token, and stylesheet surfaces', async () => {
  const requests = [];
  const fakeFetch = async (url) => {
    requests.push(String(url));
    if (String(url).endsWith('/api/health')) {
      return Response.json({ ok: true }, { status: 200 });
    }
    if (String(url).endsWith('/login')) {
      return new Response(
        '<!doctype html><title>Kovo Starter</title><link rel="stylesheet" href="/assets/app.css">',
        {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Kovo-Build': 'sha256:document-build-token',
          },
          status: 200,
        },
      );
    }
    if (String(url).endsWith('/assets/app.css')) {
      return new Response('body{color:black}', {
        headers: { 'Content-Type': 'text/css; charset=utf-8' },
        status: 200,
      });
    }
    return new Response('not found', { status: 404 });
  };

  const probe = await probePublicCloudRun('https://kovo-g11.example.run.app', fakeFetch);
  assert.deepEqual(requests, [
    'https://kovo-g11.example.run.app/api/health',
    'https://kovo-g11.example.run.app/login',
    'https://kovo-g11.example.run.app/assets/app.css',
  ]);
  assert.deepEqual(probe.statuses, { health: 200, login: 200, stylesheet: 200 });
  assert.equal(probe.stylesheetPath, '/assets/app.css');

  const proof = await verifyPublicCloudRunJourney({
    fetchImplementation: fakeFetch,
    nowEpochSeconds: 10_000,
    origin: 'https://kovo-g11.example.run.app',
    retentionUntilEpochSeconds: 10_000 + 25 * 60 * 60,
    service: 'kovo-g11-123-1',
    sourceSha: SOURCE_SHA,
  });
  assert.equal(proof.schema, G11_CLOUD_RUN_PROOF_SCHEMA);
  assert.equal(proof.host, 'Google Cloud Run');
  assert.equal(proof.retention.strategy, 'version-addressed-cloud-run-service');
});

test('fails the public proof closed on missing document identity or a short horizon', async () => {
  const missingBuildFetch = async (url) => {
    if (String(url).endsWith('/api/health')) return Response.json({ ok: true });
    return new Response(
      '<!doctype html><title>Kovo Starter</title><link rel="stylesheet" href="/app.css">',
      { headers: { 'Content-Type': 'text/html' } },
    );
  };
  await assert.rejects(
    probePublicCloudRun('https://kovo-g11.example.run.app', missingBuildFetch),
    /omitted the Kovo-Build/u,
  );
  await assert.rejects(
    verifyPublicCloudRunJourney({
      fetchImplementation: missingBuildFetch,
      nowEpochSeconds: 10_000,
      origin: 'https://kovo-g11.example.run.app',
      retentionUntilEpochSeconds: 10_000 + 23 * 60 * 60,
      service: 'kovo-g11-123-1',
      sourceSha: SOURCE_SHA,
    }),
    /full 24-hour retention horizon/u,
  );
});

test('sweeps only managed version-addressed services and deletes only after the floor', () => {
  const inventory = [
    {
      metadata: {
        labels: {
          'kovo-g11-managed': 'true',
          'kovo-g11-retain-until': '2000',
          'kovo-g11-source-sha': SOURCE_SHA,
        },
        name: 'kovo-g11-123-1',
      },
      status: { url: 'https://kovo-g11-123-1.example.run.app' },
    },
    {
      metadata: {
        labels: {
          'kovo-g11-managed': 'true',
          'kovo-g11-retain-until': '900',
          'kovo-g11-source-sha': SOURCE_SHA,
        },
        name: 'kovo-g11-124-1',
      },
      status: { url: 'https://kovo-g11-124-1.example.run.app' },
    },
    {
      metadata: {
        labels: { app: 'production' },
        name: 'do-not-touch',
      },
      status: { url: 'https://production.example.run.app' },
    },
  ];
  const sweep = selectRetentionSweepActions(inventory, 1_000);
  assert.equal(sweep.schema, G11_CLOUD_RUN_SWEEP_SCHEMA);
  assert.deepEqual(
    sweep.actions.map(({ action, service }) => ({ action, service })),
    [
      { action: 'probe', service: 'kovo-g11-123-1' },
      { action: 'probe-and-delete', service: 'kovo-g11-124-1' },
    ],
  );
  assert.throws(
    () =>
      selectRetentionSweepActions(
        [
          {
            metadata: {
              labels: {
                'kovo-g11-managed': 'true',
                'kovo-g11-retain-until': '900',
                'kovo-g11-source-sha': SOURCE_SHA,
              },
              name: 'production',
            },
            status: { url: 'https://production.example.run.app' },
          },
        ],
        1_000,
      ),
    /Refusing non-G11/u,
  );
});

test('the workflow contract keeps deployment authority main-only and OIDC-based', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/g11-cloud-run.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /id-token: write/u);
  assert.match(workflow, /environment:\s+g11-cloud-run/u);
  assert.match(
    workflow,
    /uses: google-github-actions\/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093/u,
  );
  assert.match(
    workflow,
    /uses: google-github-actions\/setup-gcloud@aa5489c8933f4cc7a4f7d45035b3b1440c9c10db/u,
  );
  assert.match(workflow, /--no-traffic/u);
  assert.match(workflow, /run services update-traffic/u);
  assert.match(workflow, /--to-latest/u);
  assert.match(workflow, /probe-and-delete/u);
  assert.match(workflow, /steps\.verify\.outcome == 'failure'/u);
  assert.doesNotMatch(workflow, /steps\.public\.outcome == 'success'/u);
  assert.doesNotMatch(workflow, /service-account-key|credentials_json|VERCEL_TOKEN/iu);
});
