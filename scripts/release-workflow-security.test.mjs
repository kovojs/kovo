import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const releaseWorkflow = readFileSync(
  new URL('../.github/workflows/release.yml', import.meta.url),
  'utf8',
);
const DOWNLOAD_ARTIFACT_ACTION =
  'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093';
const ATTEST_ACTION = 'actions/attest@f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6';
const CHECKOUT_ACTION = 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5';
const RELEASE_ARTIFACT_NAME = 'kovo-release-${{ github.sha }}';
const RELEASE_ARCHIVE_NAME = `${RELEASE_ARTIFACT_NAME}.tgz`;
const RELEASE_ARTIFACT_ID = '${{ needs.prepare.outputs.release-artifact-id }}';
const ATTESTATION_DOWNLOAD_DIRECTORY = '${{ runner.temp }}/kovo-release-attestation';
const ATTESTATION_ARCHIVE_PATH = `${ATTESTATION_DOWNLOAD_DIRECTORY}/${RELEASE_ARTIFACT_NAME}/${RELEASE_ARCHIVE_NAME}`;
const PUBLISH_RELEASE_DOWNLOAD_DIRECTORY = '${{ runner.temp }}/kovo-release-artifact';
const PUBLISH_ARCHIVE_PATH = `${PUBLISH_RELEASE_DOWNLOAD_DIRECTORY}/${RELEASE_ARTIFACT_NAME}/${RELEASE_ARCHIVE_NAME}`;
const REPRODUCIBLE_PACK_ARTIFACT_NAME = 'kovo-reproducible-pack-attestation';
const REPRODUCIBLE_PACK_DOWNLOAD_DIRECTORY = '${{ runner.temp }}/kovo-reproducible-pack';
const REPRODUCIBLE_PACK_ATTESTATION_PATH = `${REPRODUCIBLE_PACK_DOWNLOAD_DIRECTORY}/reproducible-pack-attestation.json`;
const AUTHORIZED_CI_RUN_ID = '${{ needs.authorize.outputs.ci-run-id }}';
const GITHUB_TOKEN = '${{ github.token }}';
const GITHUB_REPOSITORY = '${{ github.repository }}';
const ATTESTATION_JOB_ACTIONS = Object.freeze([DOWNLOAD_ARTIFACT_ACTION, ATTEST_ACTION]);
const ATTESTATION_JOB_PERMISSIONS = Object.freeze([
  'artifact-metadata: write',
  'attestations: write',
  'contents: read',
  'id-token: write',
]);
const ATTESTATION_DOWNLOAD_INPUTS = `artifact-ids=${RELEASE_ARTIFACT_ID}\0path=${ATTESTATION_DOWNLOAD_DIRECTORY}`;
const ATTESTATION_SUBJECT_INPUTS = `subject-name=${RELEASE_ARCHIVE_NAME}\0subject-path=${ATTESTATION_ARCHIVE_PATH}`;
const PUBLISH_RELEASE_DOWNLOAD_INPUTS = `artifact-ids=${RELEASE_ARTIFACT_ID}\0path=${PUBLISH_RELEASE_DOWNLOAD_DIRECTORY}`;
const REPRODUCIBLE_PACK_DOWNLOAD_INPUTS = `name=${REPRODUCIBLE_PACK_ARTIFACT_NAME}\0path=${REPRODUCIBLE_PACK_DOWNLOAD_DIRECTORY}\0github-token=${GITHUB_TOKEN}\0repository=${GITHUB_REPOSITORY}\0run-id=${AUTHORIZED_CI_RUN_ID}`;
const COMMITTED_EVIDENCE_CHECKOUT_INPUTS =
  'fetch-depth=1\0persist-credentials=false\0ref=${{ github.sha }}';
const COMMITTED_EVIDENCE_SUBJECT_INPUTS = Object.freeze([
  'subject-name=security/advisories/feed.json\0subject-path=security/advisories/feed.json',
  'subject-name=security/kovo-certificate-policy-v1.json\0subject-path=security/kovo-certificate-policy-v1.json',
  'subject-name=security/kovo-certificate-v1.json\0subject-path=security/kovo-certificate-v1.json',
]);

function archiveAttestationJob(source) {
  const start = source.indexOf('  attest-release-archive:');
  const end = source.indexOf('  attest-committed-evidence:', start);
  return start < 0 || end < 0 ? '' : source.slice(start, end);
}

function committedEvidenceAttestationJob(source) {
  const start = source.indexOf('  attest-committed-evidence:');
  const end = source.indexOf('  publish:', start);
  return start < 0 || end < 0 ? '' : source.slice(start, end);
}

function publishJob(source) {
  const start = source.indexOf('  publish:');
  return start < 0 ? '' : source.slice(start);
}

function jobActions(job) {
  return [...job.matchAll(/^[ \t]+(?:-\s+)?uses:\s+(\S+)\s*$/gmu)].map((match) => match[1]);
}

function jobPermissions(job) {
  const permissionStart = job.indexOf('    permissions:');
  const permissionEnd = job.indexOf('    steps:', permissionStart);
  return job
    .slice(permissionStart, permissionEnd)
    .match(/^      [a-z-]+:\s+(?:read|write|none)$/gmu)
    ?.map((line) => line.trim());
}

function archiveAttestationJobMatchesStepAllowlist(source) {
  const job = archiveAttestationJob(source);
  const actions = jobActions(job);
  const steps = job.match(/^      -\s+/gmu) ?? [];
  const permissions = jobPermissions(job);
  const downloads = actionInputSignatures(job, DOWNLOAD_ARTIFACT_ACTION);
  const subjects = actionInputSignatures(job, ATTEST_ACTION);
  return (
    steps.length === ATTESTATION_JOB_ACTIONS.length &&
    actions.length === ATTESTATION_JOB_ACTIONS.length &&
    actions.every((action, index) => action === ATTESTATION_JOB_ACTIONS[index]) &&
    permissions?.length === ATTESTATION_JOB_PERMISSIONS.length &&
    permissions.every((permission, index) => permission === ATTESTATION_JOB_PERMISSIONS[index]) &&
    downloads.length === 1 &&
    downloads[0] === ATTESTATION_DOWNLOAD_INPUTS &&
    subjects.length === 1 &&
    subjects[0] === ATTESTATION_SUBJECT_INPUTS
  );
}

function committedEvidenceJobMatchesStepAllowlist(source) {
  const job = committedEvidenceAttestationJob(source);
  const actions = jobActions(job);
  const steps = job.match(/^      -\s+/gmu) ?? [];
  const permissions = jobPermissions(job);
  const checkouts = actionInputSignatures(job, CHECKOUT_ACTION);
  const subjects = actionInputSignatures(job, ATTEST_ACTION);
  return (
    steps.length === 4 &&
    actions.length === 4 &&
    actions[0] === CHECKOUT_ACTION &&
    actions.slice(1).every((action) => action === ATTEST_ACTION) &&
    permissions?.length === ATTESTATION_JOB_PERMISSIONS.length &&
    permissions.every((permission, index) => permission === ATTESTATION_JOB_PERMISSIONS[index]) &&
    checkouts.length === 1 &&
    checkouts[0] === COMMITTED_EVIDENCE_CHECKOUT_INPUTS &&
    subjects.length === COMMITTED_EVIDENCE_SUBJECT_INPUTS.length &&
    subjects.every((subject, index) => subject === COMMITTED_EVIDENCE_SUBJECT_INPUTS[index])
  );
}

function actionInputSignatures(job, action) {
  return job
    .split(/(?=^      - )/mu)
    .filter((step) => step.includes(`uses: ${action}`))
    .map((step) => {
      const inputs = [...step.matchAll(/^          ([a-z-]+):[ \t]+([^\r\n]+?)[ \t]*$/gmu)];
      return inputs.map((input) => `${input[1]}=${input[2]}`).join('\0');
    });
}

function publishDownloadsMatchTrustBoundary(source) {
  const downloads = actionInputSignatures(publishJob(source), DOWNLOAD_ARTIFACT_ACTION);
  return (
    downloads.length === 2 &&
    downloads[0] === PUBLISH_RELEASE_DOWNLOAD_INPUTS &&
    downloads[1] === REPRODUCIBLE_PACK_DOWNLOAD_INPUTS
  );
}

function releaseMetadataDriftScript(source = releaseWorkflow) {
  const driftStep = source.slice(
    source.indexOf('name: Verify release metadata did not drift'),
    source.indexOf('name: Archive exact verified release payload'),
  );
  const runBlock = driftStep.match(/run: \|\n((?: {10}[^\r\n]+\r?\n)+)/u)?.[1] ?? '';
  return runBlock.replace(/^ {10}/gmu, '').trim();
}

function initializeDriftFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-release-drift-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'release-audit@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'release-audit'], { cwd: root });
  writeFileSync(path.join(root, 'policy.json'), 'reviewed\n');
  execFileSync('git', ['add', 'policy.json'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', 'reviewed'], { cwd: root });
  return {
    root,
    sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  };
}

function runReleaseMetadataDriftGate(root, sha) {
  return execFileSync('bash', ['-e', '-u', '-o', 'pipefail', '-c', releaseMetadataDriftScript()], {
    cwd: root,
    env: { ...process.env, GITHUB_SHA: sha },
    stdio: 'pipe',
  });
}

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
    expect(releaseWorkflow).toContain(
      'ci-run-id: ${{ steps.authorize-release.outputs.ci-run-id }}',
    );
    expect(releaseWorkflow).toContain('id: authorize-release');
    expect(releaseWorkflow).toContain(
      'if length == 1 then .[0] else error("expected one trusted aggregate workflow run") end',
    );
    expect(releaseWorkflow).toContain(
      'printf \'ci-run-id=%s\\n\' "$(jq -er \'.id\' <<<"$workflow_run")" >> "$GITHUB_OUTPUT"',
    );
    expect(releaseWorkflow).not.toContain('skip_verify_release_input');
    expect(releaseWorkflow).not.toContain('SKIP_RELEASE_CHECKS');
  });

  it('isolates release preparation, exact attestations, and package-publish authority', () => {
    const authorizeJob = releaseWorkflow.indexOf('  authorize:');
    const prepareJob = releaseWorkflow.indexOf('  prepare:');
    const attestJob = releaseWorkflow.indexOf('  attest-release-archive:');
    const committedEvidenceJob = releaseWorkflow.indexOf('  attest-committed-evidence:');
    const publishJob = releaseWorkflow.indexOf('  publish:');
    const authorize = releaseWorkflow.slice(authorizeJob, prepareJob);
    const prepare = releaseWorkflow.slice(prepareJob, attestJob);
    const attest = archiveAttestationJob(releaseWorkflow);
    const committedEvidence = committedEvidenceAttestationJob(releaseWorkflow);
    const publish = releaseWorkflow.slice(publishJob);

    expect(authorizeJob).toBeGreaterThanOrEqual(0);
    expect(prepareJob).toBeGreaterThan(authorizeJob);
    expect(attestJob).toBeGreaterThan(prepareJob);
    expect(committedEvidenceJob).toBeGreaterThan(attestJob);
    expect(publishJob).toBeGreaterThan(committedEvidenceJob);
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
    expect(prepare).toContain('run: vp exec pnpm run check:grammar-containment');
    expect(prepare).toContain('run: vp exec pnpm run test:security-fuzz-release');
    expect(prepare).toContain('name: Archive release security fuzz counterexamples');
    expect(prepare).toContain('path: .kovo/security-failures/**');
    expect(prepare).toContain('run: vp exec pnpm run check:publish');
    expect(prepare).toContain('name: Archive exact verified release payload');
    expect(prepare).toContain(
      'release-artifact-id: ${{ steps.upload-release.outputs.artifact-id }}',
    );
    expect(prepare).toContain('id: upload-release');
    expect(prepare).toContain(
      'uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    );
    expect(prepare).toContain(`name: ${RELEASE_ARTIFACT_NAME}`);
    expect(prepare).toContain('${{ runner.temp }}/kovo-release-${{ github.sha }}.tgz');
    expect(prepare).toContain('compression-level: 0');

    expect(attest).toContain('needs: prepare');
    expect(attest).toContain('if: ${{ !inputs.dry_run }}');
    expect(attest).toContain('artifact-metadata: write');
    expect(attest).toContain('attestations: write');
    expect(attest).toContain('contents: read');
    expect(attest).toContain('id-token: write');
    expect(attest).toContain(`uses: ${DOWNLOAD_ARTIFACT_ACTION}`);
    expect(attest).toContain(`artifact-ids: ${RELEASE_ARTIFACT_ID}`);
    expect(attest).toContain(`path: ${ATTESTATION_DOWNLOAD_DIRECTORY}`);
    expect(attest).toContain(`uses: ${ATTEST_ACTION}`);
    expect(attest).toContain(`subject-name: ${RELEASE_ARCHIVE_NAME}`);
    expect(attest).toContain(`subject-path: ${ATTESTATION_ARCHIVE_PATH}`);
    expect(attest).not.toContain('security/advisories/feed.json');
    expect(attest).not.toContain('security/kovo-certificate-policy-v1.json');
    expect(attest).not.toContain('security/kovo-certificate-v1.json');
    expect(attest).not.toContain('actions/checkout@');
    expect(attest).not.toContain('voidzero-dev/setup-vp@');
    expect(attest).not.toContain('run:');
    expect(attest).not.toContain('vp install');
    expect(attest).not.toContain('npm install');
    expect(attest).not.toContain('pnpm ');
    expect(archiveAttestationJobMatchesStepAllowlist(releaseWorkflow)).toBe(true);

    expect(committedEvidence).toContain('needs: prepare');
    expect(committedEvidence).toContain('if: ${{ !inputs.dry_run }}');
    expect(committedEvidence).toContain(`uses: ${CHECKOUT_ACTION}`);
    expect(committedEvidence).toContain('fetch-depth: 1');
    expect(committedEvidence).toContain('persist-credentials: false');
    expect(committedEvidence).toContain('ref: ${{ github.sha }}');
    for (const subject of [
      'security/advisories/feed.json',
      'security/kovo-certificate-policy-v1.json',
      'security/kovo-certificate-v1.json',
    ]) {
      expect(committedEvidence).toContain(`subject-name: ${subject}`);
      expect(committedEvidence).toContain(`subject-path: ${subject}`);
    }
    expect(committedEvidence).not.toContain('voidzero-dev/setup-vp@');
    expect(committedEvidence).not.toContain('run:');
    expect(committedEvidence).not.toContain('vp install');
    expect(committedEvidence).not.toContain('npm install');
    expect(committedEvidence).not.toContain('pnpm ');
    expect(committedEvidenceJobMatchesStepAllowlist(releaseWorkflow)).toBe(true);
    expect(releaseWorkflow.split(`uses: ${ATTEST_ACTION}`)).toHaveLength(5);
    expect(releaseWorkflow).not.toContain('attest-advisory-feed');
    expect(releaseWorkflow.match(/^\s+artifact-metadata: write$/gmu)).toHaveLength(2);
    expect(releaseWorkflow.match(/^\s+attestations: write$/gmu)).toHaveLength(2);

    expect(publish).toContain('if: ${{ !inputs.dry_run }}');
    expect(publish).toContain('- authorize');
    expect(publish).toContain('- prepare');
    expect(publish).toContain('- attest-release-archive');
    expect(publish).toContain('- attest-committed-evidence');
    expect(publish).toContain('environment: release');
    expect(publish).toContain('id-token: write');
    expect(publish).not.toContain('artifact-metadata: write');
    expect(publish).not.toContain('attestations: write');
    expect(publish).toContain('uses: actions/checkout@');
    expect(publish).toContain('ref: ${{ github.sha }}');
    expect(publish).toContain(`uses: ${DOWNLOAD_ARTIFACT_ACTION}`);
    expect(publish).toContain(`artifact-ids: ${RELEASE_ARTIFACT_ID}`);
    expect(publish).toContain(`name: ${REPRODUCIBLE_PACK_ARTIFACT_NAME}`);
    expect(publish).toContain(`path: ${REPRODUCIBLE_PACK_DOWNLOAD_DIRECTORY}`);
    expect(publish).toContain(`github-token: ${GITHUB_TOKEN}`);
    expect(publish).toContain(`repository: ${GITHUB_REPOSITORY}`);
    expect(publish).toContain(`run-id: ${AUTHORIZED_CI_RUN_ID}`);
    expect(publishDownloadsMatchTrustBoundary(releaseWorkflow)).toBe(true);
    expect(publish).toContain(`RELEASE_ARCHIVE: ${PUBLISH_ARCHIVE_PATH}`);
    expect(publish).toContain('name: Restore exact verified release payload');
    expect(publish).toContain('npm_version="$(vp exec npm --version)"');
    expect(publish).toContain('npm >=11.5.1 is required');
    expect(publish).toContain('member ~ /^\\//');
    expect(publish).toContain('index(member, "\\\\") != 0');
    expect(publish).toContain('segment[index_] == ".."');
    expect(publish).toContain('substr($1, 1, 1) != "-"');
    expect(publish).toContain(
      `REPRODUCIBLE_PACK_ATTESTATION: ${REPRODUCIBLE_PACK_ATTESTATION_PATH}`,
    );
    expect(publish).toContain('vp exec node scripts/verify-reproducible-release-subjects.mjs');
    expect(publish).toContain('--attestation "$REPRODUCIBLE_PACK_ATTESTATION"');
    expect(publish).toContain('--source "$GITHUB_SHA"');
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

  it('rejects any additional action in the archive attestation job', () => {
    const mutated = releaseWorkflow.replace(
      '      - name: Attest exact verified release archive',
      '      - uses: actions/cache@2f8e54208210a422b2efd51efaa6bd6d7ca8920f\n\n' +
        '      - name: Attest exact verified release archive',
    );
    expect(mutated).not.toBe(releaseWorkflow);
    expect(archiveAttestationJobMatchesStepAllowlist(mutated)).toBe(false);
  });

  it('rejects a substituted or merely comment-mentioned attestation subject', () => {
    const mutated = releaseWorkflow.replace(
      `          subject-name: ${RELEASE_ARCHIVE_NAME}`,
      `          # subject-name: ${RELEASE_ARCHIVE_NAME}\n` +
        '          subject-name: security/kovo-certificate-v1.json',
    );
    expect(mutated).not.toBe(releaseWorkflow);
    expect(archiveAttestationJobMatchesStepAllowlist(mutated)).toBe(false);
  });

  it('rejects artifact or path substitutions across the attestation boundary', () => {
    const wrongArtifact = releaseWorkflow.replace(
      `          artifact-ids: ${RELEASE_ARTIFACT_ID}\n          path: ${ATTESTATION_DOWNLOAD_DIRECTORY}`,
      `          artifact-ids: 42\n          path: ${ATTESTATION_DOWNLOAD_DIRECTORY}`,
    );
    const wrongSubjectPath = releaseWorkflow.replace(
      `          subject-path: ${ATTESTATION_ARCHIVE_PATH}`,
      '          subject-path: security/kovo-certificate-v1.json',
    );
    expect(wrongArtifact).not.toBe(releaseWorkflow);
    expect(wrongSubjectPath).not.toBe(releaseWorkflow);
    expect(archiveAttestationJobMatchesStepAllowlist(wrongArtifact)).toBe(false);
    expect(archiveAttestationJobMatchesStepAllowlist(wrongSubjectPath)).toBe(false);
  });

  it('rejects extra authority or subject drift in the committed-evidence job', () => {
    const extraAction = releaseWorkflow.replace(
      '      - name: Attest exact advisory feed',
      '      - uses: actions/cache@2f8e54208210a422b2efd51efaa6bd6d7ca8920f\n\n' +
        '      - name: Attest exact advisory feed',
    );
    const wrongSubject = releaseWorkflow.replace(
      '          subject-path: security/advisories/feed.json',
      '          subject-path: security/kovo-certificate-v1.json',
    );
    expect(extraAction).not.toBe(releaseWorkflow);
    expect(wrongSubject).not.toBe(releaseWorkflow);
    expect(committedEvidenceJobMatchesStepAllowlist(extraAction)).toBe(false);
    expect(committedEvidenceJobMatchesStepAllowlist(wrongSubject)).toBe(false);
  });

  it('rejects a substituted CI run or subject artifact at the publish boundary', () => {
    const wrongRun = releaseWorkflow.replace(
      `          run-id: ${AUTHORIZED_CI_RUN_ID}`,
      '          run-id: 42',
    );
    const wrongArtifact = releaseWorkflow.replace(
      `          name: ${REPRODUCIBLE_PACK_ARTIFACT_NAME}`,
      '          name: attacker-selected-subjects',
    );
    expect(wrongRun).not.toBe(releaseWorkflow);
    expect(wrongArtifact).not.toBe(releaseWorkflow);
    expect(publishDownloadsMatchTrustBoundary(wrongRun)).toBe(false);
    expect(publishDownloadsMatchTrustBoundary(wrongArtifact)).toBe(false);
  });

  it('rejects build-time drift anywhere in the tracked release tree', () => {
    const commands = releaseMetadataDriftScript().split(/\r?\n/u);
    expect(commands).toEqual([
      'set -euo pipefail',
      'test "$(git --no-replace-objects rev-parse HEAD)" = "$GITHUB_SHA"',
      'git -c core.filemode=true -c core.symlinks=true -c core.trustctime=true -c core.checkStat=default -c core.fsmonitor=false update-index --really-refresh',
      'git ls-files -v | awk \'substr($0, 1, 1) != "H" { exit 1 }\'',
      'git diff --no-ext-diff --no-textconv --ignore-submodules=none --check',
      'git diff --cached --no-ext-diff --no-textconv --ignore-submodules=none --check "$GITHUB_SHA" --',
      'git diff --no-ext-diff --no-textconv --ignore-submodules=none --exit-code',
      'git diff --cached --no-ext-diff --no-textconv --ignore-submodules=none --exit-code "$GITHUB_SHA" --',
    ]);
    expect(releaseMetadataDriftScript()).not.toContain('packages/*/package.json');
    expect(releaseMetadataDriftScript()).not.toMatch(/git diff --exit-code --/u);
  });

  it('executes the tracked-tree gate against staged, committed, and hidden mutations', () => {
    const control = initializeDriftFixture();
    try {
      expect(() => runReleaseMetadataDriftGate(control.root, control.sha)).not.toThrow();
    } finally {
      rmSync(control.root, { force: true, recursive: true });
    }

    for (const attack of ['staged-textconv', 'local-commit', 'skip-worktree']) {
      const fixture = initializeDriftFixture();
      try {
        writeFileSync(path.join(fixture.root, 'policy.json'), 'attacker-blessed\n');
        if (attack === 'staged-textconv') {
          execFileSync('git', ['add', 'policy.json'], { cwd: fixture.root });
          execFileSync('git', ['config', 'diff.hide.textconv', '/usr/bin/true'], {
            cwd: fixture.root,
          });
          writeFileSync(
            path.join(fixture.root, '.git', 'info', 'attributes'),
            'policy.json diff=hide\n',
          );
        } else if (attack === 'local-commit') {
          execFileSync('git', ['add', 'policy.json'], { cwd: fixture.root });
          execFileSync('git', ['commit', '--quiet', '-m', 'attacker'], { cwd: fixture.root });
        } else {
          execFileSync('git', ['update-index', '--skip-worktree', 'policy.json'], {
            cwd: fixture.root,
          });
        }
        expect(() => runReleaseMetadataDriftGate(fixture.root, fixture.sha), attack).toThrow();
      } finally {
        rmSync(fixture.root, { force: true, recursive: true });
      }
    }
  });

  it('pins every workflow action to an immutable commit', () => {
    const actionRefs = [...releaseWorkflow.matchAll(/uses:\s+[^\s@]+@([^\s]+)/gu)].map(
      (match) => match[1],
    );
    expect(actionRefs.length).toBeGreaterThan(0);
    for (const ref of actionRefs) expect(ref).toMatch(/^[0-9a-f]{40}$/u);
  });
});
