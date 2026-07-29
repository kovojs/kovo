import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertArtifactFileBudget,
  assertRedactedArtifact,
  discoverEnvSecrets,
  fitsArtifactAppByteBudget,
  fitsArtifactFileBudget,
  preserveRedactedFailureArtifact,
  redactSecrets,
} from './artifacts.mjs';

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('golden-journey failure artifacts', () => {
  it('redacts env values, credential patterns, transcripts, and symlink targets', () => {
    const root = temporaryRoot();
    const app = path.join(root, 'app');
    const artifacts = path.join(root, 'artifacts');
    mkdirSync(path.join(app, 'src'), { recursive: true });
    mkdirSync(path.join(app, 'node_modules', 'secret-package'), { recursive: true });
    const csrf = 'csrf-super-secret-value';
    const password = 'demo-super-secret-value';
    writeFileSync(
      path.join(app, '.env'),
      `KOVO_CSRF_SECRET=${csrf}\nKOVO_DEMO_PASSWORD=${password}\n`,
    );
    writeFileSync(
      path.join(app, '.env.example'),
      'KOVO_CSRF_SECRET=replace-me\nDATABASE_URL=postgres://user:example@host/db\n',
    );
    writeFileSync(
      path.join(app, 'src', 'failure.log'),
      [
        `leaked=${csrf}`,
        `Authorization: Bearer abcdefghijklmnop`,
        `postgres://user:database-password@localhost/db`,
        `Cookie: session=${password}`,
      ].join('\n'),
    );
    symlinkSync('../.env', path.join(app, 'src', 'env-link'));
    writeFileSync(path.join(app, 'node_modules', 'secret-package', 'index.js'), password);

    const result = preserveRedactedFailureArtifact({
      appRoot: app,
      artifactRoot: artifacts,
      label: 'sqlite',
      transcripts: [
        {
          phase: 'dev',
          status: 1,
          stdout: `KOVO_DEMO_PASSWORD=${password}`,
          stderr: `Bearer abcdefghijklmnop ${csrf}`,
        },
      ],
    });

    const inventory = discoverEnvSecrets(app);
    expect(inventory.keys).toEqual(['KOVO_CSRF_SECRET', 'KOVO_DEMO_PASSWORD']);
    expect(readFileSync(path.join(result.directory, 'app/src/failure.log'), 'utf8')).not.toContain(
      csrf,
    );
    expect(readFileSync(path.join(result.directory, 'app/src/failure.log'), 'utf8')).not.toContain(
      password,
    );
    expect(readFileSync(path.join(result.directory, 'redaction-manifest.json'), 'utf8')).toContain(
      'omitted-symlink',
    );
    expect(() => assertRedactedArtifact(result.directory, inventory.values)).not.toThrow();
  });

  it('recognizes exact secrets before applying shape-based redaction', () => {
    expect(redactSecrets('value=top-secret-value', ['top-secret-value'])).toBe(
      'value=[REDACTED:DISCOVERED]',
    );
    expect(redactSecrets('Authorization: Bearer abcdefghijklmnop')).toBe(
      'Authorization: Bearer [REDACTED]',
    );
    expect(redactSecrets('postgres://user:password@db.example/test')).toBe(
      'postgres://user:[REDACTED]@db.example/test',
    );
  });

  it('fails the final scan when an exact secret is introduced after preservation', () => {
    const root = temporaryRoot();
    mkdirSync(path.join(root, 'artifact'));
    writeFileSync(path.join(root, 'artifact', 'leak.txt'), 'hostile-exact-secret');

    expect(() =>
      assertRedactedArtifact(path.join(root, 'artifact'), ['hostile-exact-secret']),
    ).toThrow(/exact discovered secret/u);
  });

  it('reserves metadata inside the total 4096-file artifact bound', () => {
    expect(fitsArtifactFileBudget(4_094)).toBe(true);
    expect(fitsArtifactFileBudget(4_095)).toBe(false);
    expect(() => assertArtifactFileBudget(4_094)).not.toThrow();
    expect(() => assertArtifactFileBudget(4_095)).toThrow(/4096-file bound/u);
  });

  it('reserves two maximum-size metadata files inside the 64 MiB aggregate bound', () => {
    expect(fitsArtifactAppByteBudget(60 * 1024 * 1024 - 1, 1)).toBe(true);
    expect(fitsArtifactAppByteBudget(60 * 1024 * 1024, 1)).toBe(false);
  });

  it('keeps hostile high-volume transcripts inside the per-file artifact bound', () => {
    const root = temporaryRoot();
    const app = path.join(root, 'app');
    const artifacts = path.join(root, 'artifacts');
    mkdirSync(app);
    writeFileSync(path.join(app, 'failure.txt'), 'bounded source\n');
    const result = preserveRedactedFailureArtifact({
      appRoot: app,
      artifactRoot: artifacts,
      label: 'bounded-transcript',
      transcripts: Array.from({ length: 40 }, (_, index) => ({
        phase: `phase-${String(index)}`,
        status: 1,
        stdout: '\u0001'.repeat(100_000),
        stderr: 'TOKEN=hostile-transcript-secret '.repeat(5_000),
      })),
    });
    const transcript = path.join(result.directory, 'command-transcripts.json');

    expect(statSync(transcript).size).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(readFileSync(transcript, 'utf8')).toContain('artifact-truncation');
    expect(() => assertRedactedArtifact(result.directory)).not.toThrow();
  });
});

function temporaryRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-golden-artifact-test-'));
  roots.push(root);
  return root;
}
