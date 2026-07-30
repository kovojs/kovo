import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createStarterApp, withStarterBinOnPath } from './index.test-support.js';

describe('create-kovo starter (current-source quick check)', () => {
  it.each(['postgres', 'sqlite'] as const)(
    'passes the generated %s quick check without claiming deployment retention',
    (dialect) => {
      const app = createStarterApp({
        dialect,
        name: `${dialect} Source Check Proof`,
        tempPrefix: `create-kovo-${dialect}-source-check-`,
      });

      try {
        const packageSource = readFileSync(join(app.root, 'package.json'), 'utf8');
        expect(packageSource).toBe(`${JSON.stringify(JSON.parse(packageSource), null, 2)}\n`);

        const config = readFileSync(join(app.root, 'kovo.config.ts'), 'utf8');
        expect(config).toMatch(/^  preset: node\(\),$/m);
        expect(config).not.toMatch(/^  preset: node\(\{$/m);

        const output = execFileSync('pnpm', ['run', 'check'], {
          cwd: app.root,
          encoding: 'utf8',
          env: withStarterBinOnPath(app.root),
          maxBuffer: 128 * 1024 * 1024,
        });

        expect(output).toContain('kovo-check/v1');
        expect(output).toContain(
          'COVERAGE component=ContactsRegion query=contacts.items position="expression" status=fragment',
        );
        expect(output).not.toContain('endpoint-posture');
        expect(existsSync(join(app.root, 'dist'))).toBe(false);
      } finally {
        app.cleanup();
      }
    },
    240_000,
  );
});
