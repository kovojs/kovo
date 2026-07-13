import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('workspace server Vite source entry', () => {
  it('installs source resolution before statically linking the compiler and style graph', () => {
    const probe = spawnSync(
      process.execPath,
      [
        '--experimental-transform-types',
        '--input-type=module',
        '-e',
        `
const serverVite = await import('@kovojs/server/vite');
if (typeof serverVite.kovo !== 'function') throw new Error('missing kovo Vite factory');
const plugin = serverVite.kovo({ app: '/src/app.tsx' });
if (plugin.name !== 'kovo') throw new Error('unexpected Kovo Vite plugin');
`,
      ],
      { cwd: serverRoot, encoding: 'utf8' },
    );

    expect(probe.status, `${probe.stdout}\n${probe.stderr}`).toBe(0);
  });
});
