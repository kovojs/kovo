#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeFrameworkRuntimeSurface,
  expandFrameworkExportPostureLedger,
  FRAMEWORK_EXPORT_POSTURE_LEDGER,
  validateFrameworkExportPosture,
} from './framework-export-posture-gate.mjs';

const SUMMARY_VERSION = 'kovo-framework-public-runtime-export-posture/2026-07-29.1';
const SERVER = '@kovojs/server';
const TEST = '@kovojs/test';
const UI = '@kovojs/ui';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ledger = JSON.parse(readFileSync(FRAMEWORK_EXPORT_POSTURE_LEDGER, 'utf8'));
const actual = computeFrameworkRuntimeSurface();
const actualPackages = new Map(actual.packages.map((entry) => [entry.packageName, entry]));
const originalRows = expandFrameworkExportPostureLedger(ledger);

ledger.summaryVersion = SUMMARY_VERSION;
reconcileEmptyPackages();

for (const reviewedPackage of ledger.packages) {
  const actualPackage = actualPackages.get(reviewedPackage.packageName);
  if (actualPackage === undefined) {
    throw new Error(`stale reviewed package ${reviewedPackage.packageName}`);
  }
  reviewedPackage.manifestVariants = actualPackage.manifestVariants;
  reviewedPackage.packageVersion = actualPackage.packageVersion;
  reviewedPackage.sourceTreeSha256 = actualPackage.sourceTreeSha256;
  retainActualMembers(reviewedPackage, actualPackage);
}

reconcileServer();
reconcileTest();
reconcileUi();

for (const reviewedPackage of ledger.packages) {
  normalizeGroups(reviewedPackage);
}

const findings = validateFrameworkExportPosture({ actual, ledger });
if (findings.length > 0) {
  throw new Error(`reviewed posture reconciliation is incomplete:\n${findings.join('\n')}`);
}

if (process.argv.includes('--write')) {
  writeFileSync(
    FRAMEWORK_EXPORT_POSTURE_LEDGER,
    formatGeneratedLedger(`${JSON.stringify(ledger, null, 2)}\n`),
    'utf8',
  );
}

const rows = expandFrameworkExportPostureLedger(ledger);
const runtimeCount = rows.filter((row) => row.name !== '<module>').length;
process.stdout.write(
  `worldclass-api-posture/v1 packages=${ledger.packages.length} subpaths=${
    rows.length - runtimeCount
  } runtime=${runtimeCount}${process.argv.includes('--write') ? ' written' : ' checked'}\n`,
);

function reconcileEmptyPackages() {
  const actualEmptyPackages = new Map(
    actual.emptyPackages.map((entry) => [entry.packageName, entry]),
  );
  for (const reviewedPackage of ledger.emptyPublicPackages) {
    const actualPackage = actualEmptyPackages.get(reviewedPackage.packageName);
    if (actualPackage === undefined) {
      throw new Error(`stale reviewed empty package ${reviewedPackage.packageName}`);
    }
    if (reviewedPackage.packageName === '@kovojs/compiler') continue;
    reviewedPackage.manifestVariants = actualPackage.manifestVariants;
    reviewedPackage.packageVersion = actualPackage.packageVersion;
    reviewedPackage.sourceTreeSha256 = actualPackage.sourceTreeSha256;
  }
}

function formatGeneratedLedger(candidate) {
  const formatted = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'vp', 'fmt', `--stdin-filepath=${FRAMEWORK_EXPORT_POSTURE_LEDGER}`],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      input: candidate,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  if (
    formatted.error ||
    formatted.signal ||
    formatted.status !== 0 ||
    formatted.stdout.length === 0
  ) {
    throw new Error(
      `Unable to format framework export posture ledger: ${
        formatted.stderr.trim() || formatted.error?.message || formatted.signal || formatted.status
      }`,
    );
  }
  return formatted.stdout;
}

function retainActualMembers(reviewedPackage, actualPackage) {
  const actualMembers = new Set(
    Object.entries(actualPackage.members).flatMap(([subpath, names]) =>
      names.map((name) => memberKey(subpath, name)),
    ),
  );
  reviewedPackage.postureGroups = reviewedPackage.postureGroups.map((group) => ({
    ...group,
    members: Object.fromEntries(
      Object.entries(group.members)
        .map(([subpath, names]) => [
          subpath,
          names.filter((name) => actualMembers.has(memberKey(subpath, name))),
        ])
        .filter(([, names]) => names.length > 0),
    ),
  }));
}

function reconcileServer() {
  const reviewedPackage = packageRow(SERVER);
  const actualPackage = actualPackageRow(SERVER);
  const actualRows = Object.entries(actualPackage.members).flatMap(([subpath, names]) =>
    names.map((name) => ({ name, subpath })),
  );
  const reviewedKeys = reviewedMemberKeys(reviewedPackage);
  const originalServerRows = originalRows.filter((row) => row.packageName === SERVER);
  const actualKeys = new Set(actualRows.map((row) => memberKey(row.subpath, row.name)));

  const missingNamedRows = actualRows.filter(
    (row) => row.name !== '<module>' && !reviewedKeys.has(memberKey(row.subpath, row.name)),
  );
  for (const missing of missingNamedRows) {
    if (missing.subpath === '.' && missing.name === 'tag') {
      addMember(
        groupRow(reviewedPackage, 'authority-free-security-control-runtime-infra-a1e9e15415'),
        missing.subpath,
        missing.name,
      );
      continue;
    }
    const prior = originalServerRows.filter(
      (row) =>
        row.name === missing.name &&
        !actualKeys.has(memberKey(row.subpath, row.name)) &&
        row.name !== '<module>',
    );
    if (prior.length !== 1) {
      throw new Error(
        `${SERVER}${missing.subpath}#${missing.name} has ${prior.length} reviewed prior homes`,
      );
    }
    addMember(groupRow(reviewedPackage, prior[0].groupId), missing.subpath, missing.name);
  }

  const moduleGroup = groupRow(
    reviewedPackage,
    'framework-door-module-initializer-server-crypto-process',
  );
  for (const { name, subpath } of actualRows) {
    if (name === '<module>' && !reviewedMemberKeys(reviewedPackage).has(memberKey(subpath, name))) {
      addMember(moduleGroup, subpath, name);
    }
  }
  moduleGroup.review = {
    basis:
      'Every manifest-public @kovojs/server entry eagerly imports security-bootstrap, which pins process posture and the purpose-closed crypto authority before exposing named values; module initialization remains classified separately from those values.',
    evidence: [
      'packages/server/src/public-agent.ts',
      'packages/server/src/public-security.ts',
      'packages/server/src/security-bootstrap.ts',
    ],
    id: 'first-party-runtime-posture/2026-07-29-semantic-subpaths',
  };

  for (const group of reviewedPackage.postureGroups) {
    const exactRootMatch = group.review.basis.match(/@kovojs\/server#([A-Za-z0-9_$]+)/u);
    if (exactRootMatch === null) continue;
    const symbol = exactRootMatch[1];
    const homes = Object.entries(group.members).flatMap(([subpath, names]) =>
      names.includes(symbol) ? [subpath] : [],
    );
    if (homes.length !== 1) {
      throw new Error(`${group.id} cannot resolve the current home of ${symbol}`);
    }
    const specifier = homes[0] === '.' ? SERVER : `${SERVER}${homes[0].slice(1)}`;
    group.review.basis = group.review.basis.replace(
      `@kovojs/server#${symbol}`,
      `${specifier}#${symbol}`,
    );
  }
}

function reconcileTest() {
  const reviewedPackage = packageRow(TEST);
  upsertGroup(reviewedPackage, {
    capabilities: ['crypto-acquisition'],
    disposition: 'request-closed',
    id: 'request-closed-test-csrf-crypto-acquisition-v1',
    matrix: {
      cells: {
        A: 'public-runtime-export-posture-control',
        Au: 'public-runtime-export-posture-control',
        C: 'public-runtime-export-posture-control',
        I: 'public-runtime-export-posture-control',
      },
      surface: 'build-compiler',
    },
    members: {
      './csrf': ['<module>', 'mutationCsrfTokenForTesting'],
    },
    reason:
      'CSRF token minting here is explicit test-process setup authority and is not a request-handler capability door.',
    review: {
      basis:
        'The focused test helper reaches Kovo’s purpose-closed CSRF signing path only to prepare synthetic mutation submissions; both module evaluation and the named helper remain request-closed.',
      evidence: [
        'packages/server/src/csrf.ts',
        'packages/server/src/internal/csrf.ts',
        'packages/test/src/csrf.ts',
      ],
      id: 'first-party-runtime-posture/2026-07-29-test-harness-v2',
    },
    rootKind: 'none',
    securityRole: 'request-closed',
  });
  upsertGroup(reviewedPackage, {
    capabilities: ['database-driver', 'filesystem', 'process'],
    disposition: 'request-closed',
    id: 'request-closed-test-postgres-database-filesystem-process-v1',
    matrix: {
      cells: {
        A: 'public-runtime-export-posture-control',
        Au: 'public-runtime-export-posture-control',
        C: 'public-runtime-export-posture-control',
        I: 'public-runtime-export-posture-control',
      },
      surface: 'db-data-plane',
    },
    members: {
      './postgres': ['<module>', 'createPostgresTestRuntime'],
    },
    reason:
      'Ephemeral Postgres construction is explicit test-process setup authority and is not a request-handler capability door.',
    review: {
      basis:
        'The Postgres test helper owns an ephemeral PGlite data directory and exercises Kovo’s real database posture only from the test process; the former public server/testing door has been removed.',
      evidence: [
        'packages/server/src/internal/testing.ts',
        'packages/server/src/postgres-runtime.ts',
        'packages/server/src/testing.ts',
        'packages/test/src/postgres.ts',
      ],
      id: 'first-party-runtime-posture/2026-07-29-test-harness-v2',
    },
    rootKind: 'none',
    securityRole: 'request-closed',
  });
}

function reconcileUi() {
  const reviewedPackage = packageRow(UI);
  const componentGroup = groupRow(
    reviewedPackage,
    'authority-free-ordinary-runtime-render-browser-c978dcdfd5',
  );
  for (const name of ['CardContent', 'CardDescription', 'CardFooter', 'CardHeader', 'CardTitle']) {
    addMember(componentGroup, './card', name);
  }
  for (const group of reviewedPackage.postureGroups) {
    group.review.evidence = [
      ...new Set(
        group.review.evidence.map((entry) =>
          entry === 'packages/ui/src/index.tsx' ? 'packages/ui/src/card.tsx' : entry,
        ),
      ),
    ];
  }
}

function normalizeGroups(reviewedPackage) {
  reviewedPackage.postureGroups = reviewedPackage.postureGroups
    .filter((group) => Object.keys(group.members).length > 0)
    .map((group) => ({
      ...group,
      members: Object.fromEntries(
        Object.entries(group.members)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([subpath, names]) => [
            subpath,
            [...new Set(names)].sort((left, right) => left.localeCompare(right)),
          ]),
      ),
    }));
}

function packageRow(packageName) {
  const row = ledger.packages.find((entry) => entry.packageName === packageName);
  if (row === undefined) throw new Error(`missing reviewed package ${packageName}`);
  return row;
}

function actualPackageRow(packageName) {
  const row = actualPackages.get(packageName);
  if (row === undefined) throw new Error(`missing actual package ${packageName}`);
  return row;
}

function groupRow(reviewedPackage, groupId) {
  const row = reviewedPackage.postureGroups.find((entry) => entry.id === groupId);
  if (row === undefined) {
    throw new Error(`${reviewedPackage.packageName} is missing posture group ${groupId}`);
  }
  return row;
}

function upsertGroup(reviewedPackage, group) {
  const index = reviewedPackage.postureGroups.findIndex((entry) => entry.id === group.id);
  if (index === -1) reviewedPackage.postureGroups.push(group);
  else reviewedPackage.postureGroups[index] = group;
}

function addMember(group, subpath, name) {
  group.members[subpath] ??= [];
  if (!group.members[subpath].includes(name)) group.members[subpath].push(name);
}

function reviewedMemberKeys(reviewedPackage) {
  return new Set(
    reviewedPackage.postureGroups.flatMap((group) =>
      Object.entries(group.members).flatMap(([subpath, names]) =>
        names.map((name) => memberKey(subpath, name)),
      ),
    ),
  );
}

function memberKey(subpath, name) {
  return `${subpath}\0${name}`;
}
