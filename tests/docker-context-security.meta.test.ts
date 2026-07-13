import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function dockerignorePatterns(): Set<string> {
  return new Set(
    readFileSync(join(root, '.dockerignore'), 'utf8')
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#')),
  );
}

describe('public image build context', () => {
  it('excludes nested local secrets from broad-copy Dockerfiles', () => {
    // The demo and docs images both use COPY . ., so the shared context policy
    // is the security boundary preventing gitignored operator secrets from
    // becoming readable layers in a published image.
    expect(readFileSync(join(root, 'Dockerfile'), 'utf8')).toContain('COPY . .');
    expect(readFileSync(join(root, 'site/Dockerfile'), 'utf8')).toContain('COPY . .');

    const patterns = dockerignorePatterns();
    for (const pattern of [
      '**/.env',
      '**/.env.*',
      '**/.netrc',
      '**/.git-credentials',
      '**/.ssh',
      '**/.aws',
      '**/.config/gcloud',
      '**/*.key',
      '**/*.pem',
      '**/*.p12',
      '**/*.pfx',
    ]) {
      expect(patterns, `missing Docker build-context exclusion ${pattern}`).toContain(pattern);
    }
  });
});
