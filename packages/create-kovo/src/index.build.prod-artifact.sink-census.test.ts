import { describe, expect, it } from 'vitest';

import { assertRequiredSinkInventoryEvidence } from './index.build.prod-artifact.sink-census.js';

describe('prod artifact sink census inventory evidence', () => {
  it('requires hostile-value proof references for the DEC-F sink set', () => {
    const entries = assertRequiredSinkInventoryEvidence([
      {
        hostileValueProof: 'packages/server/src/managed-db.test.ts',
        sink: 'db driver statement',
      },
      {
        hostileValueProof: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
        sink: 'http response body',
      },
      {
        hostileValueProof: 'packages/create-kovo/src/index.build.prod-artifact.headers.test.ts',
        sink: 'http response headers',
      },
      {
        hostileValueProof:
          'packages/create-kovo/src/index.build.prod-artifact.redirect-capability.test.ts',
        sink: 'redirect URL',
      },
      {
        hostileValueProof: 'packages/create-kovo/src/index.build.prod-artifact.headers.test.ts',
        sink: 'Set-Cookie',
      },
      {
        hostileValueProof: 'packages/server/src/static-export-output.test.ts',
        sink: 'blob/file write',
      },
      {
        hostileValueProof: 'packages/server/src/task-observability.test.ts',
        sink: 'durable-task payload',
      },
      {
        hostileValueProof: 'packages/server/src/webhook.test.ts',
        sink: 'webhook payload',
      },
      {
        hostileValueProof: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
        sink: 'HTML/render output',
      },
      {
        hostileValueProof: 'packages/core/src/secret.test.ts',
        sink: 'log/error output',
      },
      {
        hostileValueProof: 'packages/server/src/task-runner.test.ts',
        sink: 'outbound egress request',
      },
    ]);

    expect(entries).toHaveLength(11);
  });
});
