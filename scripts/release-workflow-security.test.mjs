import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const releaseWorkflow = readFileSync(
  new URL('../.github/workflows/release.yml', import.meta.url),
  'utf8',
);

describe('release workflow authority', () => {
  it('admits only an exact successful main commit and has no dispatch bypass', () => {
    expect(releaseWorkflow).toContain('test "$RELEASE_REF" = refs/heads/main');
    expect(releaseWorkflow).toContain('.app.id == 15368');
    expect(releaseWorkflow).toContain('.app.slug == "github-actions"');
    expect(releaseWorkflow).toContain('.app.owner.id == 9919');
    expect(releaseWorkflow).toContain('.app.owner.login == "github"');
    expect(releaseWorkflow).toContain('.head_sha == $sha');
    expect(releaseWorkflow).toContain('/actions/workflows/293607412/runs?');
    expect(releaseWorkflow).toContain('.workflow_id == 293607412');
    expect(releaseWorkflow).toContain('.event == "push"');
    expect(releaseWorkflow).toContain('.head_branch == "main"');
    expect(releaseWorkflow).toContain('.path == ".github/workflows/ci.yml"');
    expect(releaseWorkflow).toContain('.check_suite_id == $suite');
    expect(releaseWorkflow).not.toContain('skip_verify_release_input');
    expect(releaseWorkflow).not.toContain('SKIP_RELEASE_CHECKS');
  });

  it('isolates release preparation, feed attestation, and package-publish authority', () => {
    const authorizeJob = releaseWorkflow.indexOf('  authorize:');
    const prepareJob = releaseWorkflow.indexOf('  prepare:');
    const attestJob = releaseWorkflow.indexOf('  attest-advisory-feed:');
    const publishJob = releaseWorkflow.indexOf('  publish:');
    const authorize = releaseWorkflow.slice(authorizeJob, prepareJob);
    const prepare = releaseWorkflow.slice(prepareJob, attestJob);
    const attest = releaseWorkflow.slice(attestJob, publishJob);
    const publish = releaseWorkflow.slice(publishJob);

    expect(authorizeJob).toBeGreaterThanOrEqual(0);
    expect(prepareJob).toBeGreaterThan(authorizeJob);
    expect(attestJob).toBeGreaterThan(prepareJob);
    expect(publishJob).toBeGreaterThan(attestJob);
    expect(authorize).not.toContain('environment: release');
    expect(authorize).not.toContain('id-token: write');
    expect(authorize).not.toContain('actions/checkout@');
    expect(authorize).not.toContain('voidzero-dev/setup-vp@');

    expect(prepare).toContain('needs: authorize');
    expect(prepare).toContain('checks: read');
    expect(prepare).not.toContain('environment: release');
    expect(prepare).not.toContain('id-token: write');
    expect(prepare).toContain('uses: actions/checkout@');
    expect(prepare).toContain('ref: ${{ github.sha }}');
    expect(prepare).toContain('persist-credentials: false');
    expect(prepare).toContain('run: vp install --frozen-lockfile');
    expect(prepare).toContain('run: vp exec pnpm run test:security-fuzz-release');
    expect(prepare).toContain('name: Archive release security fuzz counterexamples');
    expect(prepare).toContain('path: .kovo/security-failures/**');
    expect(prepare).toContain('run: vp exec pnpm run check:publish');
    expect(prepare).toContain('name: Archive exact verified release payload');
    expect(prepare).toContain('uses: actions/upload-artifact@');
    expect(prepare).toContain('${{ runner.temp }}/kovo-release-${{ github.sha }}.tgz');

    expect(attest).toContain('needs: prepare');
    expect(attest).toContain('attestations: write');
    expect(attest).toContain('contents: read');
    expect(attest).toContain('id-token: write');
    expect(attest).toContain('uses: actions/attest@f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6');
    expect(attest).toContain('subject-name: security/advisories/feed.json');
    expect(attest).toContain('subject-path: security/advisories/feed.json');
    expect(attest).toContain('ref: ${{ github.sha }}');
    expect(attest).toContain('persist-credentials: false');
    expect(attest).not.toContain('voidzero-dev/setup-vp@');
    expect(attest).not.toContain('run:');
    expect(attest).not.toContain('vp install');
    expect(attest).not.toContain('npm install');
    expect(attest).not.toContain('pnpm ');

    expect(publish).toContain('if: ${{ !inputs.dry_run }}');
    expect(publish).toContain('- prepare');
    expect(publish).toContain('- attest-advisory-feed');
    expect(publish).toContain('environment: release');
    expect(publish).toContain('id-token: write');
    expect(publish).toContain('uses: actions/checkout@');
    expect(publish).toContain('ref: ${{ github.sha }}');
    expect(publish).toContain('uses: actions/download-artifact@');
    expect(publish).toContain('name: Restore exact verified release payload');
    expect(publish).toContain('npm_version="$(vp exec npm --version)"');
    expect(publish).toContain('npm >=11.5.1 is required');
    expect(publish).toContain('member ~ /^\\//');
    expect(publish).toContain('index(member, "\\\\") != 0');
    expect(publish).toContain('segment[index_] == ".."');
    expect(publish).toContain('substr($1, 1, 1) != "-"');
    expect(publish).toContain(
      'run: vp exec node scripts/publish-packed-packages.mjs --tag "$DIST_TAG"',
    );
    expect(publish).not.toContain('run: vp install');
    expect(publish).not.toContain('run: npm install');
    expect(publish).not.toContain('check:publish');
    expect(publish).not.toContain('pnpm pack');
    expect(publish).not.toContain('verify-release-input.mjs');
    expect(publish).not.toContain('test:security-fuzz-release');
    expect(publish).not.toContain('.kovo/security-failures');
  });

  it('rejects build-time drift anywhere in the tracked release tree', () => {
    const driftStep = releaseWorkflow.slice(
      releaseWorkflow.indexOf('name: Verify release metadata did not drift'),
      releaseWorkflow.indexOf('name: Archive exact verified release payload'),
    );
    expect(driftStep).toContain('git diff --check');
    expect(driftStep).toContain('git diff --exit-code');
    expect(driftStep).not.toContain('packages/*/package.json');
    expect(driftStep).not.toMatch(/git diff --exit-code --/u);
  });

  it('pins every workflow action to an immutable commit', () => {
    const actionRefs = [...releaseWorkflow.matchAll(/uses:\s+[^\s@]+@([^\s]+)/gu)].map(
      (match) => match[1],
    );
    expect(actionRefs.length).toBeGreaterThan(0);
    for (const ref of actionRefs) expect(ref).toMatch(/^[0-9a-f]{40}$/u);
  });
});
