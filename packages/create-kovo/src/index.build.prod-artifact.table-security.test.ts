import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeKovoProject } from './index.js';
import {
  buildParanoidProductionArtifact,
  execFileSyncErrorOutput,
} from './index.build.test-support.js';
import { linkStarterBuildDependencies } from './index.test-support.js';

describe('create-kovo production table-security provenance', () => {
  it('rejects an exact Drizzle annotation-slot replacement during paranoid preflight', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-table-security-slot-'));

    try {
      mkdirSync(root, { recursive: true });
      writeKovoProject(root, { dialect: 'sqlite', name: 'Table Security Slot Proof' });
      linkStarterBuildDependencies(root);
      const schemaPath = join(root, 'src/schema.ts');
      const schema = readFileSync(schemaPath, 'utf8');
      writeFileSync(
        schemaPath,
        `${schema}\nimport { Table } from 'drizzle-orm';\nconst exactExtraConfigBuilder = Reflect.get(Reflect.get(Table, 'Symbol'), 'ExtraConfigBuilder');\nObject.defineProperty(contacts, exactExtraConfigBuilder, {\n  configurable: true,\n  enumerable: true,\n  value: Object.assign(() => [], { domain: 'public', public: true }),\n  writable: true,\n});\n`,
        'utf8',
      );

      let output: string | undefined;
      try {
        buildParanoidProductionArtifact(root);
      } catch (error) {
        output = execFileSyncErrorOutput(error);
      }

      expect(output, 'forged Drizzle metadata must fail paranoid preflight').toBeDefined();
      expect(output).toContain('KV424');
      expect(output).toContain('source=Reflect.get');
      expect(output).toContain('sink=request-handler.opaque-protocol');
      expect(output).toContain('source=<Object.defineProperty-target:contacts>');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 180_000);
});
