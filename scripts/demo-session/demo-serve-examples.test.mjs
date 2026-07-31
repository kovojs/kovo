import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('hosted demo serve examples', () => {
  for (const fixture of [
    {
      exportName: 'createCrmDemoServer',
      label: 'CRM',
      module: 'examples/crm/scripts/demo-serve.mjs',
      root: 'examples/crm',
    },
    {
      exportName: 'createSoDemoServer',
      label: 'StackOverflow',
      module: 'examples/stackoverflow/scripts/demo-serve.mjs',
      root: 'examples/stackoverflow',
    },
  ]) {
    it(
      `boots ${fixture.label} through the multitenant Vite demo path`,
      () => {
        const moduleHref = pathToFileURL(join(process.cwd(), fixture.module)).href;
        const source = [
          `const { ${fixture.exportName} } = await import(${JSON.stringify(moduleHref)});`,
          `const served = await ${fixture.exportName}({ host: '127.0.0.1', port: 0 });`,
          "if (!(served.port > 0)) throw new Error('demo server did not bind a port');",
          'await served.close();',
        ].join('\n');

        expect(() =>
          execFileSync(process.execPath, ['--input-type=module', '--eval', source], {
            cwd: join(process.cwd(), fixture.root),
            env: {
              ...process.env,
              KOVO_CRM_CSRF_SECRET: 'demo-serve-test-crm-csrf-secret',
              KOVO_LIVE_TARGET_SECRET: 'demo-serve-test-live-target-secret',
              KOVO_STACKOVERFLOW_CSRF_SECRET: 'demo-serve-test-stackoverflow-csrf-secret',
            },
            maxBuffer: 32 * 1024 * 1024,
            stdio: 'pipe',
          }),
        ).not.toThrow();
      },
      180_000,
    );
  }
});
