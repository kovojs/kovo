import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectSpecModuleLinks,
  movedSectionMappings,
  requiredSpecModules,
  validateSpecIndex,
} from './check-spec-index.mjs';

describe('spec-index gate', () => {
  it('extracts root spec module links without counting fenced examples', () => {
    expect(
      collectSpecModuleLinks(
        [
          '[Component](spec/04-component-model.md)',
          '[Compiler]: ./spec/05-compiler.md#pipeline',
          '<spec/06-type-system.md>',
          '```md',
          '[Ignored](spec/99-ignored.md)',
          '```',
        ].join('\n'),
      ),
    ).toEqual(['spec/04-component-model.md', 'spec/05-compiler.md', 'spec/06-type-system.md']);
  });

  it('skips the known pre-split state before spec modules or root module links exist', async () => {
    const rootDir = await fixtureRoot();
    await writeFile(
      path.join(rootDir, 'SPEC.md'),
      Array.from({ length: 1201 }, (_, index) => `line ${index + 1}`).join('\n'),
    );

    expect(validateSpecIndex({ rootDir })).toEqual({
      ok: true,
      skipped: true,
      findings: [],
      summary:
        'pre-split SPEC.md detected; spec-index enforcement starts when spec/ or root module links exist',
    });
  });

  it('accepts the intended split when the root links modules, diagnostics owner, and old sections', async () => {
    const rootDir = await completeSplitFixture();

    expect(validateSpecIndex({ rootDir })).toMatchObject({
      ok: true,
      skipped: false,
      findings: [],
    });
  });

  it('rejects required modules that are present but not linked from the root spec', async () => {
    const rootDir = await completeSplitFixture({
      omittedRequiredLinks: ['spec/09-wire-protocol.md'],
      omittedMappings: ['9'],
    });

    expect(validateSpecIndex({ rootDir }).findings).toContain(
      'SPEC.md must link required spec module: spec/09-wire-protocol.md',
    );
  });

  it('rejects root spec links that point at missing spec module files', async () => {
    const rootDir = await completeSplitFixture({
      extraRootLinks: ['spec/99-missing.md'],
    });

    expect(validateSpecIndex({ rootDir }).findings).toContain(
      'SPEC.md links spec/99-missing.md, but that file does not exist',
    );
  });

  it('rejects existing spec modules that are not linked from the root spec', async () => {
    const rootDir = await completeSplitFixture({
      extraSpecFiles: ['spec/99-extra.md'],
    });

    expect(validateSpecIndex({ rootDir }).findings).toContain(
      'SPEC.md must link existing spec module: spec/99-extra.md',
    );
  });

  it('requires the diagnostic owner/source to point at spec/11-diagnostics.md', async () => {
    const rootDir = await completeSplitFixture({ includeDiagnosticOwner: false });

    expect(validateSpecIndex({ rootDir }).findings).toContain(
      'SPEC.md must identify spec/11-diagnostics.md as the diagnostic registry owner/source',
    );
  });

  it('requires old numeric SPEC citations to remain discoverable through a root mapping', async () => {
    const rootDir = await completeSplitFixture({ omittedMappings: ['8'] });

    expect(validateSpecIndex({ rootDir }).findings).toContain(
      'SPEC.md must map old SPEC §8 citations to spec/07-navigation.md',
    );
  });
});

async function completeSplitFixture({
  extraRootLinks = [],
  extraSpecFiles = [],
  includeDiagnosticOwner = true,
  omittedMappings = [],
  omittedRequiredLinks = [],
} = {}) {
  const rootDir = await fixtureRoot();
  await mkdir(path.join(rootDir, 'spec'), { recursive: true });

  for (const specModule of [...requiredSpecModules, ...extraSpecFiles]) {
    await writeFile(path.join(rootDir, specModule), `# ${specModule}\n`);
  }

  const requiredLinks = requiredSpecModules
    .filter((specModule) => !omittedRequiredLinks.includes(specModule))
    .map((specModule) => `- [${specModule}](${specModule})`);
  const extraLinks = extraRootLinks.map((specModule) => `- [${specModule}](${specModule})`);
  const mappingRows = movedSectionMappings
    .filter((mapping) => !omittedMappings.includes(mapping.section))
    .map((mapping) => `| SPEC §${mapping.section} | [module](${mapping.target}) |`);
  const diagnosticOwner = includeDiagnosticOwner
    ? 'Diagnostic registry owner/source: [Diagnostics](spec/11-diagnostics.md) is authoritative.'
    : 'Diagnostics are summarized in the root spec.';

  await writeFile(
    path.join(rootDir, 'SPEC.md'),
    [
      '# Kovo Technical Specification',
      '',
      '## Normative Module Index',
      '',
      ...requiredLinks,
      ...extraLinks,
      '',
      diagnosticOwner,
      '',
      '## Old Section Compatibility Map',
      '',
      '| Old citation | Module |',
      '| --- | --- |',
      ...mappingRows,
      '',
    ].join('\n'),
  );

  return rootDir;
}

async function fixtureRoot() {
  return mkdtemp(path.join(tmpdir(), 'kovo-spec-index-'));
}
