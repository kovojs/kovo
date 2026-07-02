import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildReusableProductionArtifact } from './index.build.test-support.js';
import { createStarterApp } from './index.test-support.js';

describe('create-kovo starter (build integration: scaffold production)', () => {
  it('runs the generated production build graph gate', () => {
    const app = createStarterApp({
      name: 'Build Prod Proof',
      tempPrefix: 'create-kovo-build-prod-',
    });

    try {
      buildReusableProductionArtifact(app.root);
    } finally {
      app.cleanup();
    }
  }, 120_000);

  it('rebuilds production artifacts from current source when cache is warm', () => {
    const app = createStarterApp({
      name: 'Build Source Proof',
      tempPrefix: 'create-kovo-build-source-proof-',
    });

    try {
      buildReusableProductionArtifact(app.root);
      const firstHandler = readFileSync(join(app.root, 'dist/server/server/handler.mjs'), 'utf8');
      expect(firstHandler).toContain('Contacts');

      const contactsPath = join(app.root, 'src/components/contacts.tsx');
      writeFileSync(
        contactsPath,
        readFileSync(contactsPath, 'utf8').replace('Contacts</h1>', 'Current Source Contacts</h1>'),
        'utf8',
      );

      buildReusableProductionArtifact(app.root);
      const secondHandler = readFileSync(join(app.root, 'dist/server/server/handler.mjs'), 'utf8');
      expect(secondHandler).toContain('Current Source Contacts');
      expect(secondHandler).not.toBe(firstHandler);
    } finally {
      app.cleanup();
    }
  }, 240_000);
});
