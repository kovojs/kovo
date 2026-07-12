import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const sourceDirectory = fileURLToPath(new URL('.', import.meta.url));

describe('server security bootstrap census', () => {
  it('eagerly imports every server intrinsic membrane', () => {
    const source = readFileSync(new URL('./security-bootstrap.ts', import.meta.url), 'utf8');
    const intrinsicModules = readdirSync(sourceDirectory)
      .filter((fileName) => fileName.endsWith('-intrinsics.ts'))
      .sort();

    expect(intrinsicModules.length).toBeGreaterThan(0);
    for (const fileName of intrinsicModules) {
      expect(source, fileName).toContain(`'./${fileName.replace(/\.ts$/u, '.js')}'`);
    }
  });

  it('is the first dependency of every supported server entry', () => {
    const entries = [
      ['build.ts', "import './security-bootstrap.js';"],
      ['index.ts', "import './security-bootstrap.js';"],
      ['jsx-runtime.ts', "import './security-bootstrap.js';"],
      ['testing.ts', "import './security-bootstrap.js';"],
      ['vite.ts', "import './security-bootstrap.js';"],
      ['internal/app-shell-vite.ts', "import '../security-bootstrap.js';"],
      ['internal/build.ts', "import '../security-bootstrap.js';"],
      ['internal/static-export.ts', "import '../security-bootstrap.js';"],
    ] as const;

    for (const [fileName, bootstrapImport] of entries) {
      const source = readFileSync(new URL(fileName, import.meta.url), 'utf8');
      expect(source.indexOf(bootstrapImport), fileName).toBe(0);
    }
  });
});
