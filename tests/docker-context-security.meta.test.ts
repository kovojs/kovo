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

  it('pins privileged Cloud Build tools and uses per-build artifact tags', () => {
    const dockerBuilder =
      'gcr.io/cloud-builders/docker@sha256:6c9b879570fe1c63a78af0b575ca5ac52f6c2c7e25f76f91ae1f2d6cb2a872ee';
    const cloudSdkBuilder =
      'gcr.io/google.com/cloudsdktool/cloud-sdk@sha256:db6c7fccfc6046e4b5a2180772d6426aa89cba5f84d879f2e89c989d9d08f4f7';

    for (const path of ['cloudbuild.yaml', 'site/cloudbuild.yaml']) {
      const source = readFileSync(join(root, path), 'utf8');
      const builderNames = Array.from(
        source.matchAll(/^\s*name:\s*(\S+)\s*$/gmu),
        (match) => match[1],
      );

      expect(builderNames.filter((name) => name.includes('/docker'))).not.toHaveLength(0);
      expect(builderNames.filter((name) => name.includes('/docker'))).toEqual(
        expect.arrayContaining([dockerBuilder]),
      );
      expect(builderNames.filter((name) => name.includes('/docker'))).toSatisfy((names: string[]) =>
        names.every((name) => name === dockerBuilder),
      );
      expect(builderNames.filter((name) => name.includes('/cloud-sdk'))).toEqual([cloudSdkBuilder]);
      expect(source).toContain(':${BUILD_ID}');
      expect(source).not.toMatch(/^\s*_TAG:\s*latest\s*$/mu);
      expect(source).not.toContain(':${_TAG}');
    }
  });
});
