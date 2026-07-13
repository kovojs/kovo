import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { MutationReplayStore, WebhookReplayStore } from './index.js';

const serverPackageRoot = resolve(process.cwd(), 'packages/server');
const vpBin = resolve(process.cwd(), 'node_modules/.bin/vp');

describe('built-bundle durable replay receipts (SPEC §10.3)', () => {
  it('shares core-authenticated receipts across bundle A and bundle B while rejecting forgeries', async () => {
    const root = mkdtempSync(join(serverPackageRoot, '.tmp-replay-receipt-bundles-'));
    const bundleAPath = join(root, 'bundle-a');
    const bundleBPath = join(root, 'bundle-b');
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      packServerBundle(bundleAPath);
      packServerBundle(bundleBPath);

      const bundleA = (await import(
        pathToFileURL(join(bundleAPath, 'index.mjs')).href
      )) as typeof import('./index.js');
      const bundleB = (await import(
        pathToFileURL(join(bundleBPath, 'index.mjs')).href
      )) as typeof import('./index.js');
      const executor = {
        async execute() {
          return { rows: [] };
        },
      };
      const mutationStoreFromA = bundleA.createPostgresMutationReplayStore(executor);
      const webhookStoreFromA = bundleA.createPostgresWebhookReplayStore(executor);
      const mutationFromB = bundleB.mutation('receipt/cross-bundle', {
        csrf: false,
        handler(input) {
          return input;
        },
        input: bundleB.s.object({ value: bundleB.s.string() }),
      });

      expect(() =>
        bundleB.createApp({
          egress: {
            enabled: false,
            justification: 'cross-bundle receipt test performs no outbound I/O',
          },
          mutationReplayStore: mutationStoreFromA,
          mutations: [mutationFromB],
        }),
      ).not.toThrow();

      const records = bundleB.domain('receipt-cross-bundle-records');
      expect(() =>
        bundleB.webhook('/webhooks/cross-bundle', {
          handler() {},
          idempotency: (input) => input.id,
          input: bundleB.s.object({ id: bundleB.s.string() }),
          replayStore: webhookStoreFromA,
          verify: 'none',
          verifyJustification: 'cross-bundle production replay posture test',
          writes: [records],
        }),
      ).not.toThrow();

      expect(() =>
        bundleB.createApp({
          egress: {
            enabled: false,
            justification: 'cross-bundle receipt test performs no outbound I/O',
          },
          mutationReplayStore: forgedMutationStore(),
          mutations: [mutationFromB],
        }),
      ).toThrow(/KV436.*createPostgresMutationReplayStore/);
      expect(() =>
        bundleB.webhook('/webhooks/cross-bundle-forged', {
          handler() {},
          idempotency: (input) => input.id,
          input: bundleB.s.object({ id: bundleB.s.string() }),
          replayStore: forgedWebhookStore(),
          verify: 'none',
          verifyJustification: 'cross-bundle production replay posture test',
          writes: [records],
        }),
      ).toThrow(/KV436.*createPostgresWebhookReplayStore/);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      rmSync(root, { force: true, recursive: true });
    }
  }, 30_000);
});

function packServerBundle(outDir: string): void {
  execFileSync(vpBin, ['pack', 'src/index.ts', '-d', outDir, '--no-dts', '--logLevel', 'silent'], {
    cwd: serverPackageRoot,
    stdio: 'pipe',
  });
}

function forgedMutationStore(): MutationReplayStore {
  return {
    get() {
      return undefined;
    },
    reserve() {
      return { commit() {} };
    },
    set() {},
    [Symbol.for('kovo.durable-replay-store')]: true,
  };
}

function forgedWebhookStore(): WebhookReplayStore {
  return {
    get() {
      return undefined;
    },
    reserve() {
      return { commit() {} };
    },
    set() {},
    [Symbol.for('kovo.durable-replay-store')]: true,
  };
}
