import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { collectPackageFrontDoorFindings } from './package-front-door.mjs';

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('package front doors', () => {
  it('keeps every manifest-public package front door accurate', () => {
    expect(collectPackageFrontDoorFindings()).toEqual([]);
  });

  it('rejects internal imports, unpublished source links, and repository guidance', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kovo-package-front-door-'));
    roots.push(root);
    await mkdir(path.join(root, 'packages/example'), { recursive: true });
    await writeFile(
      path.join(root, 'packages/example/README.md'),
      [
        '# @kovojs/example',
        '',
        "import { hidden } from '@kovojs/example/internal';",
        '',
        '[Source](./src/index.ts)',
        '',
        'Run `scripts/build-example.mjs` and inspect `public-packages.json`.',
        '',
      ].join('\n'),
    );
    const packages = [
      {
        apiBoundary: { generated: [], internal: ['./internal'], public: ['.'] },
        dir: 'example',
        kind: 'library',
        name: '@kovojs/example',
        visibility: 'public',
      },
    ];

    expect(collectPackageFrontDoorFindings({ packages, root })).toEqual([
      'packages/example/README.md: imports non-app-public entry @kovojs/example/internal',
      'packages/example/README.md: package front door exposes repository-internal guidance',
      'packages/example/README.md: packed README links to unpublished ./src content',
    ]);
  });
});
