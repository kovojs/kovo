import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import { writeKovoProject } from './index.js';
import { buildParanoidProductionArtifact } from './index.build.test-support.js';
import {
  collectOutput,
  linkStarterBuildDependencies,
  stopProcess,
  withRepoBinOnPath,
} from './index.test-support.js';

describe('create-kovo production table-security provenance', () => {
  it('rejects an exact Drizzle annotation-slot replacement across production bundle copies', async () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-table-security-slot-'));
    let server: ChildProcessWithoutNullStreams | undefined;

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

      buildParanoidProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          KOVO_PARANOID: '1',
          NODE_ENV: 'production',
          PORT: '0',
        },
      });
      const output = collectOutput(server);
      await Promise.race([
        new Promise<void>((resolve) => server?.once('exit', () => resolve())),
        delay(30_000).then(() => {
          throw new Error(`Forged production server did not exit:\n${output()}`);
        }),
      ]);

      expect(output()).toContain('KV414: runtime Drizzle table security for contacts');
      expect(output()).toContain('compiler-derived manifest');
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 180_000);
});
