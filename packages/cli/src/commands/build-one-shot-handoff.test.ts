import { readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createKovoBuildOneShotHandoffDirectory,
  kovoBuildOneShotDigest,
  parseKovoBuildOneShotProducerControl,
  readKovoBuildOneShotHandoff,
  writeKovoBuildOneShotHandoff,
  type KovoBuildOneShotIdentity,
} from './build-one-shot-handoff.js';

function identity(root: string): KovoBuildOneShotIdentity {
  return {
    appModulePath: 'src/app.tsx',
    compilerProvenanceDigest: kovoBuildOneShotDigest({ compiler: '0.3.0' }),
    configSourceDigest: kovoBuildOneShotDigest({ config: 'node' }),
    invocationRoot: root,
    optionsDigest: kovoBuildOneShotDigest({ cache: true, preset: 'node' }),
    sourceSetDigest: kovoBuildOneShotDigest([{ fileName: 'src/app.tsx', source: 'safe' }]),
  };
}

describe('one-shot build handoff', () => {
  it('round-trips one exact project-confined content-addressed payload', () => {
    const root = process.cwd();
    const directory = createKovoBuildOneShotHandoffDirectory(root);
    try {
      const expectedIdentity = identity(root);
      const payload = {
        analysis: { checkGraph: { routes: [] } },
        identity: expectedIdentity,
        schema: 'kovo-build-one-shot-analysis/v1' as const,
      };
      const reference = writeKovoBuildOneShotHandoff(directory, payload);

      expect(basename(reference.file)).toBe(`${reference.digest.slice('sha256:'.length)}.json`);
      expect(readKovoBuildOneShotHandoff(reference, expectedIdentity)).toEqual(payload);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it.each([
    ['app', { appModulePath: 'src/other.tsx' }],
    ['config', { configSourceDigest: kovoBuildOneShotDigest({ config: 'cloudflare' }) }],
    ['compiler', { compilerProvenanceDigest: kovoBuildOneShotDigest({ compiler: 'forged' }) }],
    ['source set', { sourceSetDigest: kovoBuildOneShotDigest([{ source: 'changed' }]) }],
    ['options', { optionsDigest: kovoBuildOneShotDigest({ cache: false }) }],
  ])('rejects a stale or wrong %s identity', (_label, changed) => {
    const root = process.cwd();
    const directory = createKovoBuildOneShotHandoffDirectory(root);
    try {
      const producedIdentity = identity(root);
      const reference = writeKovoBuildOneShotHandoff(directory, {
        analysis: {},
        identity: producedIdentity,
        schema: 'kovo-build-one-shot-analysis/v1',
      });
      expect(() =>
        readKovoBuildOneShotHandoff(reference, { ...producedIdentity, ...changed }),
      ).toThrow(/stale or belongs to another invocation/u);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('rejects incomplete, tampered, and renamed envelopes', () => {
    const root = process.cwd();
    const directory = createKovoBuildOneShotHandoffDirectory(root);
    try {
      const expectedIdentity = identity(root);
      const reference = writeKovoBuildOneShotHandoff(directory, {
        analysis: {},
        identity: expectedIdentity,
        schema: 'kovo-build-one-shot-analysis/v1',
      });
      const original = readFileSync(reference.file, 'utf8');

      writeFileSync(reference.file, '{"schema":"kovo-build-one-shot-handoff/v1"}\n');
      expect(() => readKovoBuildOneShotHandoff(reference, expectedIdentity)).toThrow(/incomplete/u);

      const tampered = JSON.parse(original) as { payload: string };
      tampered.payload = tampered.payload.replace('"analysis":{}', '"analysis":{"forged":true}');
      writeFileSync(reference.file, `${JSON.stringify(tampered)}\n`);
      expect(() => readKovoBuildOneShotHandoff(reference, expectedIdentity)).toThrow(
        /unauthenticated/u,
      );

      writeFileSync(reference.file, original);
      expect(() =>
        readKovoBuildOneShotHandoff(
          { ...reference, file: join(dirname(reference.file), 'renamed.json') },
          expectedIdentity,
        ),
      ).toThrow(/filename is not content-addressed/u);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('rejects symlinked files and handoff roots', () => {
    const root = process.cwd();
    const directory = createKovoBuildOneShotHandoffDirectory(root);
    const secondDirectory = createKovoBuildOneShotHandoffDirectory(root);
    try {
      const expectedIdentity = identity(root);
      const reference = writeKovoBuildOneShotHandoff(directory, {
        analysis: {},
        identity: expectedIdentity,
        schema: 'kovo-build-one-shot-analysis/v1',
      });
      const alias = join(secondDirectory, basename(reference.file));
      symlinkSync(reference.file, alias, 'file');
      expect(() =>
        readKovoBuildOneShotHandoff({ ...reference, file: alias }, expectedIdentity),
      ).toThrow(/regular non-symlink file/u);

      const linkedRoot = join(root, `.kovo-one-shot-linked-${process.pid}`);
      symlinkSync(directory, linkedRoot, 'dir');
      expect(() =>
        writeKovoBuildOneShotHandoff(linkedRoot, {
          analysis: {},
          identity: expectedIdentity,
          schema: 'kovo-build-one-shot-analysis/v1',
        }),
      ).toThrow(/non-symlink directory/u);
      rmSync(linkedRoot, { force: true });
    } finally {
      rmSync(directory, { force: true, recursive: true });
      rmSync(secondDirectory, { force: true, recursive: true });
    }
  });

  it('accepts only exact, authenticated producer control output', () => {
    const root = process.cwd();
    const expectedIdentity = identity(root);
    const control = {
      identity: expectedIdentity,
      reference: {
        digest: kovoBuildOneShotDigest({ payload: 'one-shot' }),
        file: join(root, '.kovo-one-shot-test', 'handoff.json'),
      },
      schema: 'kovo-build-one-shot-producer/v1',
    };

    expect(parseKovoBuildOneShotProducerControl(JSON.stringify(control))).toEqual(control);
    expect(() => parseKovoBuildOneShotProducerControl('{')).toThrow(/malformed control/u);
    expect(() =>
      parseKovoBuildOneShotProducerControl(JSON.stringify({ ...control, reference: undefined })),
    ).toThrow(/incomplete control/u);
    expect(() =>
      parseKovoBuildOneShotProducerControl(
        JSON.stringify({
          ...control,
          reference: { ...control.reference, digest: 'sha256:wrong' },
        }),
      ),
    ).toThrow(/digest is invalid/u);
  });
});
