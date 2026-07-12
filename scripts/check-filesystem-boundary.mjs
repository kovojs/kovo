#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import { collectSourceFiles } from './lib/source-files.mjs';

export const repoRoot = findRepoRoot();

export const defaultSourceRoots = ['packages/core/src', 'packages/server/src'];
export const filesystemBoundaryFile = 'packages/core/src/internal/filesystem.ts';
export const filesystemIntrinsicsFile = 'packages/core/src/internal/filesystem-intrinsics.ts';
export const protocolFreeFilesystemEnumerationFiles = [
  filesystemBoundaryFile,
  'packages/server/src/output-staging.ts',
  'packages/server/src/static-export-output.ts',
];
export const staticExportEndpointBlockerFile = 'packages/server/src/static-export-document.ts';
export const staticExportReplayArtifactFile = 'packages/server/src/static-export-replay.ts';
export const staticExportReplayContextFile = 'packages/server/src/static-export-replay-context.ts';
export const staticExportReplayRequestFile = 'packages/server/src/static-export-request.ts';
export const buildSecurityIntrinsicsFile = 'packages/server/src/build-security-intrinsics.ts';
export const neutralBuildFile = 'packages/server/src/neutral-build.ts';
export const neutralMetadataCommitFiles = [buildSecurityIntrinsicsFile, neutralBuildFile];
export const presetRetentionPolicyFile = 'packages/server/src/build.ts';
export const responseSecurityIntrinsicsFile = 'packages/server/src/response-security-intrinsics.ts';
export const responseSecurityArrayCommitFiles = [
  responseSecurityIntrinsicsFile,
  'packages/server/src/cookies.ts',
];
export const taskSecurityIntrinsicsFile = 'packages/server/src/task-security-intrinsics.ts';
export const taskArrayCommitFiles = [
  taskSecurityIntrinsicsFile,
  'packages/server/src/task.ts',
  'packages/server/src/task-cron.ts',
  'packages/server/src/task-observability.ts',
  'packages/server/src/task-queue.ts',
  'packages/server/src/task-runner.ts',
  'packages/server/src/task-runtime.ts',
];
export const egressSecurityIntrinsicsFile = 'packages/server/src/egress-intrinsics.ts';
export const egressArrayCommitFiles = [
  egressSecurityIntrinsicsFile,
  'packages/server/src/egress.ts',
];

export const defaultAllowedRuntimeFiles = [
  filesystemBoundaryFile,
  // The boundary's boot-pinned intrinsic membrane captures every node:fs/node:path operation,
  // Stats/Dirent predicate, temp-name source, and numeric-fd control; it never exposes a second
  // application-facing filesystem door.
  filesystemIntrinsicsFile,
  'packages/server/src/file.ts',
  'packages/server/src/output-staging.ts',
  'packages/server/src/static-export-output-targets.ts',
  'packages/server/src/static-export-output.ts',
  'packages/server/src/static-export.ts',
];

export const defaultAllowedToolingFiles = [
  'packages/server/src/build.ts',
  // Static-analysis tooling captures only `Stats.prototype.isDirectory`; all app/runtime file
  // reads still route through the core filesystem boundary (SPEC §2/§11.4).
  'packages/server/src/internal/data-plane-static-analysis-intrinsics.ts',
  'packages/server/src/internal/data-plane-static-analysis.ts',
  'packages/server/src/neutral-build.ts',
  'packages/server/src/vite.ts',
  'packages/server/src/vite-build-assets.ts',
  'packages/server/src/vite-build-output.ts',
  'packages/server/src/vite-manifest.ts',
];

export function checkFilesystemBoundary(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const sourceRoots = options.sourceRoots ?? defaultSourceRoots;
  const sourceFiles =
    options.sourceFiles ?? collectSourceFiles(root, sourceRoots, { productionRoots: sourceRoots });
  const allowedRuntimeFiles = new Set(options.allowedRuntimeFiles ?? defaultAllowedRuntimeFiles);
  const allowedToolingFiles = new Set(options.allowedToolingFiles ?? defaultAllowedToolingFiles);
  const allowedFiles = new Set([...allowedRuntimeFiles, ...allowedToolingFiles]);
  const protocolFreeEnumerationFiles = new Set(
    options.protocolFreeEnumerationFiles ?? protocolFreeFilesystemEnumerationFiles,
  );
  const staticExportEndpointBlockerFiles = new Set(
    options.staticExportEndpointBlockerFiles ?? [staticExportEndpointBlockerFile],
  );
  const staticExportReplayArtifactFiles = new Set(
    options.staticExportReplayArtifactFiles ?? [staticExportReplayArtifactFile],
  );
  const staticExportSyntheticRequestFiles = new Set(
    options.staticExportSyntheticRequestFiles ?? [
      buildSecurityIntrinsicsFile,
      staticExportReplayContextFile,
      staticExportReplayRequestFile,
    ],
  );
  const neutralStylesheetAssemblyFiles = new Set(
    options.neutralStylesheetAssemblyFiles ?? [buildSecurityIntrinsicsFile, neutralBuildFile],
  );
  const neutralPublicAssetCopyFiles = new Set(
    options.neutralPublicAssetCopyFiles ?? [filesystemBoundaryFile, neutralBuildFile],
  );
  const neutralMetadataCommitFileSet = new Set(
    options.neutralMetadataCommitFiles ?? neutralMetadataCommitFiles,
  );
  const taskArrayCommitFileSet = new Set(options.taskArrayCommitFiles ?? taskArrayCommitFiles);
  const responseSecurityArrayCommitFileSet = new Set(
    options.responseSecurityArrayCommitFiles ?? responseSecurityArrayCommitFiles,
  );
  const egressArrayCommitFileSet = new Set(
    options.egressArrayCommitFiles ?? egressArrayCommitFiles,
  );
  const presetRetentionPolicyFiles = new Set(
    options.presetRetentionPolicyFiles ?? [presetRetentionPolicyFile],
  );
  const presetDiagnosticAggregationFiles = new Set(
    options.presetDiagnosticAggregationFiles ?? [presetRetentionPolicyFile],
  );
  const cloudflareTomlAssemblyFiles = new Set(
    options.cloudflareTomlAssemblyFiles ?? [presetRetentionPolicyFile],
  );
  const nodeRuntimePackageBoundaryFiles = new Set(
    options.nodeRuntimePackageBoundaryFiles ?? [presetRetentionPolicyFile],
  );
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const exists = options.exists ?? ((relativePath) => existsSync(path.join(root, relativePath)));

  const findings = [];
  if (!exists(filesystemBoundaryFile)) {
    findings.push(`${filesystemBoundaryFile}: filesystem boundary file is missing`);
  }

  for (const filePath of sourceFiles) {
    const sourceText = readText(filePath);
    const scanText = stripCommentsAndStrings(sourceText);
    const allowed = allowedFiles.has(filePath);
    const importedPathNames = pathPrimitiveImportNames(sourceText);

    for (const match of rawFileSystemImports(sourceText)) {
      if (filePath === filesystemBoundaryFile) {
        findings.push(
          `${filePath}:${lineOf(sourceText, match.index)}: raw ${match.moduleName} controls must be boot-pinned in ${filesystemIntrinsicsFile}`,
        );
        continue;
      }
      if (!allowed) {
        findings.push(
          `${filePath}:${lineOf(sourceText, match.index)}: raw ${match.moduleName} access must route through ${filesystemBoundaryFile}`,
        );
      }
    }

    if (filePath === filesystemBoundaryFile) {
      for (const match of rawLateBoundBoundaryImports(sourceText)) {
        findings.push(
          `${filePath}:${lineOf(sourceText, match.index)}: raw ${match.moduleName} controls must be boot-pinned in ${filesystemIntrinsicsFile}`,
        );
      }
    }

    if (protocolFreeEnumerationFiles.has(filePath)) {
      const protocolLoop = /\bfor\s+await\s*\(/u.exec(scanText);
      if (protocolLoop !== null) {
        findings.push(
          `${filePath}:${lineOf(sourceText, protocolLoop.index)}: filesystem authority enumeration must use snapshotted arrays, not mutable async-iterator protocol dispatch`,
        );
      }
    }

    if (staticExportEndpointBlockerFiles.has(filePath)) {
      findings.push(...staticExportEndpointBlockerFindings(filePath, sourceText));
    }
    if (staticExportReplayArtifactFiles.has(filePath)) {
      findings.push(...staticExportReplayArtifactCommitFindings(filePath, sourceText));
    }
    if (staticExportSyntheticRequestFiles.has(filePath)) {
      findings.push(...staticExportSyntheticRequestFindings(filePath, sourceText));
    }
    if (neutralStylesheetAssemblyFiles.has(filePath)) {
      findings.push(...neutralStylesheetAssemblyFindings(filePath, sourceText));
    }
    if (neutralPublicAssetCopyFiles.has(filePath)) {
      findings.push(...neutralPublicAssetCopyFindings(filePath, sourceText));
    }
    if (neutralMetadataCommitFileSet.has(filePath)) {
      findings.push(...neutralMetadataCommitFindings(filePath, sourceText));
    }
    if (taskArrayCommitFileSet.has(filePath)) {
      findings.push(...taskArrayCommitFindings(filePath, sourceText));
    }
    if (responseSecurityArrayCommitFileSet.has(filePath)) {
      findings.push(...responseSecurityArrayCommitFindings(filePath, sourceText));
    }
    if (egressArrayCommitFileSet.has(filePath)) {
      findings.push(...egressArrayCommitFindings(filePath, sourceText));
    }
    if (presetRetentionPolicyFiles.has(filePath)) {
      findings.push(...presetRetentionPolicyFindings(filePath, sourceText));
    }
    if (presetDiagnosticAggregationFiles.has(filePath)) {
      findings.push(...presetDiagnosticAggregationFindings(filePath, sourceText));
    }
    if (cloudflareTomlAssemblyFiles.has(filePath)) {
      findings.push(...cloudflareTomlAssemblyFindings(filePath, sourceText));
    }
    if (nodeRuntimePackageBoundaryFiles.has(filePath)) {
      findings.push(...nodeRuntimePackageBoundaryFindings(filePath, sourceText));
    }

    if (!allowed && usesPathConfinementPrimitive(scanText, importedPathNames)) {
      findings.push(
        `${filePath}:${lineOf(sourceText, firstPathPrimitiveIndex(scanText, importedPathNames))}: path confinement primitives must route through ${filesystemBoundaryFile}`,
      );
    }
  }

  return {
    findings,
    ok: findings.length === 0,
    summary:
      findings.length === 0
        ? 'OK filesystem access routes through the framework filesystem boundary'
        : `${findings.length} filesystem boundary violation(s)`,
  };
}

export function staticExportEndpointBlockerFindings(filePath, sourceText) {
  const scanText = stripCommentsAndStrings(sourceText);
  const findings = [];
  const mutableDispatch =
    /\b(?:protocol\s*\.\s*)?endpointRefs\s*\.\s*(?:every|filter|find|findIndex|forEach|map|reduce|reduceRight|some)\s*\(/u.exec(
      scanText,
    );
  if (mutableDispatch !== null) {
    findings.push(
      `${filePath}:${lineOf(sourceText, mutableDispatch.index)}: static-export endpoint blocker must not dispatch through mutable collection methods`,
    );
  }

  if (!/\bsnapshotBuildArray\s*\(\s*protocol\s*\.\s*endpointRefs\s*,/u.test(scanText)) {
    findings.push(
      `${filePath}: static-export endpoint blocker must snapshot the complete endpoint-ref ledger after app evaluation`,
    );
  }

  if (
    !/\bfor\s*\(\s*let\s+[A-Za-z_$][\w$]*\s*=\s*0\s*;[^;]*<\s*endpointRefs\s*\.\s*length\s*;[^)]*\+=\s*1\s*\)/u.test(
      scanText,
    )
  ) {
    findings.push(
      `${filePath}: static-export endpoint blocker must traverse its pinned endpoint refs with an indexed loop`,
    );
  }

  return findings;
}

export function staticExportReplayArtifactCommitFindings(filePath, sourceText) {
  const scanText = stripCommentsAndStrings(sourceText);
  const findings = [];
  const mutableCommit = /\bartifacts\s*\.\s*(?:push|unshift|splice)\s*\(/u.exec(scanText);
  if (mutableCommit !== null) {
    findings.push(
      `${filePath}:${lineOf(sourceText, mutableCommit.index)}: approved static-export route artifacts must not commit through mutable collection methods`,
    );
  }
  if (!/\bcommitBuildArrayValue\s*\(\s*artifacts\s*,\s*approvedArtifact\s*,/u.test(scanText)) {
    findings.push(
      `${filePath}: approved static-export route bytes must commit through commitBuildArrayValue() after replay classification`,
    );
  }
  return findings;
}

export function staticExportSyntheticRequestFindings(filePath, sourceText) {
  const scanText = stripCommentsAndStrings(sourceText);
  const findings = [];
  const mutableUrlConstructor = /\bnew\s+(?:globalThis\s*\.\s*)?URL\s*\(/u.exec(scanText);
  if (mutableUrlConstructor !== null) {
    findings.push(
      `${filePath}:${lineOf(sourceText, mutableUrlConstructor.index)}: synthetic static-export targets must not use the mutable ambient URL constructor`,
    );
  }
  const mutableRequestConstructor = /\bnew\s+(?:globalThis\s*\.\s*)?Request\s*\(/u.exec(scanText);
  if (mutableRequestConstructor !== null) {
    findings.push(
      `${filePath}:${lineOf(sourceText, mutableRequestConstructor.index)}: synthetic static-export carriers must not use the mutable ambient Request constructor`,
    );
  }

  if (filePath === staticExportReplayRequestFile) {
    if (!/\bbuildSecurityUrlSnapshot\s*\(/u.test(scanText)) {
      findings.push(
        `${filePath}: synthetic static-export targets must use the boot-pinned URL snapshot`,
      );
    }
    if (!/\bbuildSecurityGetRequest\s*\(\s*url\s*\.\s*href\s*\)/u.test(scanText)) {
      findings.push(
        `${filePath}: synthetic static-export carriers must use the boot-pinned GET Request constructor`,
      );
    }
    if (!/\burl\s*:\s*BuildSecurityUrlSnapshot\b/u.test(sourceText)) {
      findings.push(
        `${filePath}: synthetic static-export results must retain the witnessed URL snapshot instead of a live URL`,
      );
    }
  }

  if (filePath === buildSecurityIntrinsicsFile) {
    const requiredControls = [
      [
        'captured Request constructor',
        /\bconst\s+NativeRequest\s*=\s*globalThis\s*\.\s*Request\b/u,
      ],
      ['captured URL constructor', /\bconst\s+NativeURL\s*=\s*globalThis\s*\.\s*URL\b/u],
      [
        'witnessed Request method',
        /\bnativeRequestMethod\s*=\s*stableOwnGetter\s*\(\s*NativeRequest\s*\.\s*prototype\s*,\s*['"]method['"]\s*\)/u,
      ],
      [
        'witnessed Request URL',
        /\bnativeRequestUrl\s*=\s*stableOwnGetter\s*\(\s*NativeRequest\s*\.\s*prototype\s*,\s*['"]url['"]\s*\)/u,
      ],
      ['witnessed URL href', /\bnativeUrlHref\s*=\s*stableOwnGetter\s*\(/u],
      ['witnessed URL pathname', /\bnativeUrlPathname\s*=\s*stableOwnGetter\s*\(/u],
      [
        'exact Request target check',
        /\bwitnessReflectApply\s*<\s*string\s*>\s*\(\s*nativeRequestUrl\s*,\s*request\s*,/u,
      ],
      [
        'native URL installation for Request internals',
        /\bwitnessDefineProperty\s*\(\s*nativeGlobalThis\s*,\s*['"]URL['"]\s*,/u,
      ],
      [
        'ambient URL descriptor restoration',
        /\bwitnessDefineProperty\s*\(\s*nativeGlobalThis\s*,\s*['"]URL['"]\s*,\s*lateUrlDescriptor\s*\)/u,
      ],
    ];
    for (let index = 0; index < requiredControls.length; index += 1) {
      const [label, pattern] = requiredControls[index];
      if (!pattern.test(sourceText)) {
        findings.push(
          `${filePath}: synthetic static-export construction is missing its ${label} control`,
        );
      }
    }
  }

  if (
    filePath === staticExportReplayContextFile &&
    !/\bbuildSecurityUrlSnapshot\s*\(\s*origin\s*\)/u.test(scanText)
  ) {
    findings.push(
      `${filePath}: synthetic static-export origins must use the boot-pinned URL snapshot`,
    );
  }

  return findings;
}

export function neutralStylesheetAssemblyFindings(filePath, sourceText) {
  const findings = [];
  if (filePath === buildSecurityIntrinsicsFile) {
    if (
      !/\bbuildSecurityPathJoin\s*\([^)]*\)\s*:\s*string\s*\{[\s\S]*?snapshotBuildArray\s*\(\s*values\s*,\s*['"]build security path join inputs['"]\s*\)/u.test(
        sourceText,
      )
    ) {
      findings.push(
        `${filePath}: build path join must snapshot variadic inputs before boot-pinned dispatch`,
      );
    }
    if (
      !/\bbuildSecurityPathResolve\s*\([^)]*\)\s*:\s*string\s*\{[\s\S]*?snapshotBuildArray\s*\(\s*values\s*,\s*['"]build security path resolve inputs['"]\s*\)/u.test(
        sourceText,
      )
    ) {
      findings.push(
        `${filePath}: build path resolution must snapshot variadic inputs before boot-pinned dispatch`,
      );
    }
    if (!/\bbuildSecurityPathIsAbsolute\s*\(/u.test(sourceText)) {
      findings.push(`${filePath}: neutral stylesheet confinement must use boot-pinned isAbsolute`);
    }
    return findings;
  }

  const start = sourceText.indexOf('async function materializeNeutralStylesheetAssets');
  const end = sourceText.indexOf('function isNodeError', start);
  if (start < 0 || end < 0) {
    return [`${filePath}: neutral stylesheet authority region is missing`];
  }
  const authoritySource = sourceText.slice(start, end);
  const scanText = stripCommentsAndStrings(authoritySource);
  const mutablePatterns = [
    ['collection method', /\.(?:push|join)\s*\(/u],
    ['collection iterator', /\bfor\s*\(\s*const\s+[^)]*\sof\s/u],
    ['Map constructor', /\bnew\s+Map(?:\s*<|\s*\()/u],
    [
      'Map method',
      /\b(?:cssByPath|localCssByPath|sources|sourceFileByPath|viteCssBySourceFile)\s*\.\s*(?:forEach|get|has|set)\s*\(/u,
    ],
    ['string method', /\.(?:endsWith|slice|startsWith|trim)\s*\(/u],
    ['URL constructor', /\bnew\s+(?:globalThis\s*\.\s*)?URL\s*\(/u],
  ];
  for (let index = 0; index < mutablePatterns.length; index += 1) {
    const [label, pattern] = mutablePatterns[index];
    const match = pattern.exec(scanText);
    if (match !== null) {
      findings.push(
        `${filePath}:${lineOf(sourceText, start + match.index)}: post-replay neutral stylesheet authority must not dispatch through mutable ${label}`,
      );
    }
  }

  const requiredControls = [
    ['dense CSS commit', /\bcommitBuildArrayValue\s*\(\s*chunks\s*,\s*css\s*,/u],
    ['final CSS composition', /\bsecurityArrayJoin\s*\(\s*dedupedCss\s*,/u],
    ['pinned Map construction', /\bcreateSecurityMap\s*</u],
    ['pinned Map traversal', /\bsecurityMapForEach\s*\(\s*cssByPath\s*,/u],
    ['pinned URL snapshot', /\bbuildSecurityUrlSnapshot\s*\(\s*href\s*,/u],
    ['app stylesheet snapshot', /\bsnapshotBuildArray\s*\(\s*app\s*\.\s*stylesheets\s*,/u],
    ['route snapshot', /\bsnapshotBuildArray\s*\(\s*app\s*\.\s*routes\s*,/u],
    ['pinned CSS trimming', /\bsecurityStringTrim\s*\(\s*chunk\s*\)/u],
  ];
  for (let index = 0; index < requiredControls.length; index += 1) {
    const [label, pattern] = requiredControls[index];
    if (!pattern.test(authoritySource)) {
      findings.push(`${filePath}: post-replay neutral stylesheet authority is missing ${label}`);
    }
  }
  if (
    !/\bfunction\s+neutralPathDirname\s*\([^)]*\)\s*:\s*string\s*\{\s*return\s+buildSecurityPathDirname\s*\(/u.test(
      sourceText,
    ) ||
    !/\bfunction\s+neutralPathIsAbsolute\s*\([^)]*\)\s*:\s*boolean\s*\{\s*return\s+buildSecurityPathIsAbsolute\s*\(/u.test(
      sourceText,
    )
  ) {
    findings.push(`${filePath}: neutral stylesheet paths must delegate to boot-pinned controls`);
  }
  return findings;
}

export function neutralMetadataCommitFindings(filePath, sourceText) {
  const findings = [];
  const scanText = stripCommentsAndStrings(sourceText);

  if (filePath === buildSecurityIntrinsicsFile) {
    const mutableSnapshotCommit = /\bsnapshot\s*\[\s*index\s*\]\s*=/u.exec(scanText);
    if (mutableSnapshotCommit !== null) {
      findings.push(
        `${filePath}:${lineOf(sourceText, mutableSnapshotCommit.index)}: build array snapshots must not dispatch through inherited numeric setters`,
      );
    }
    if (
      !/\bcommitBuildArrayValue\s*\(\s*snapshot\s*,\s*descriptorDataProperty\s*\(/u.test(sourceText)
    ) {
      findings.push(
        `${filePath}: build array snapshots must commit descriptor values through commitBuildArrayValue()`,
      );
    }
    return findings;
  }

  const mutableDenseCommit = /\b([A-Za-z_$][\w$]*)\s*\[\s*\1\s*\.\s*length\s*\]\s*=/u.exec(
    scanText,
  );
  if (mutableDenseCommit !== null) {
    findings.push(
      `${filePath}:${lineOf(sourceText, mutableDenseCommit.index)}: neutral build metadata must not dispatch through inherited numeric setters`,
    );
  }

  const requiredCommits = [
    ['stylesheet CSS snapshot', 'snapshot', 'neutral build stylesheet CSS snapshot'],
    [
      'registered client module artifact',
      'builtModules',
      'registered client module build artifact',
    ],
    ['client module metadata', 'metadata', 'neutral build client module metadata'],
    ['durable task metadata', 'tasks', 'neutral build task metadata'],
    [
      'static route document metadata',
      'routeDocuments',
      'neutral static export route document metadata',
    ],
    ['route diagnostic metadata', 'diagnostics', 'neutral build route diagnostic metadata'],
    ['route static path metadata', 'staticPaths', 'neutral build route static path metadata'],
    ['route entry metadata', 'entries', 'neutral build route entry metadata'],
    ['static export asset metadata', 'pinned', 'neutral static export asset metadata'],
  ];
  for (let index = 0; index < requiredCommits.length; index += 1) {
    const [description, target, label] = requiredCommits[index];
    const commitPattern = new RegExp(
      `\\bcommitBuildArrayValue\\s*\\(\\s*${target}\\s*,[\\s\\S]*?['"]${label}['"]\\s*,?\\s*\\)`,
      'u',
    );
    if (!commitPattern.test(sourceText)) {
      findings.push(`${filePath}: neutral build is missing pinned ${description}`);
    }
  }
  return findings;
}

export function neutralPublicAssetCopyFindings(filePath, sourceText) {
  const findings = [];
  if (filePath === filesystemBoundaryFile) {
    const start = sourceText.indexOf('async function confinedDirectoryEntries');
    const end = sourceText.indexOf('async function ensureParentsStayDirectories', start);
    if (start < 0 || end < 0) {
      return [`${filePath}: identity-bound filesystem entry implementation is missing`];
    }
    const authoritySource = sourceText.slice(start, end);
    const scanText = stripCommentsAndStrings(authoritySource);
    const mutableDirent = /\.\s*(?:isDirectory|isFile|isSymbolicLink)\s*\(/u.exec(scanText);
    if (mutableDirent !== null) {
      findings.push(
        `${filePath}:${lineOf(sourceText, start + mutableDirent.index)}: confined enumeration must not dispatch through mutable Dirent predicates`,
      );
    }
    const mutableTraversal = /\bfor\s*\(\s*const\s+[^)]*\sof\s/u.exec(scanText);
    if (mutableTraversal !== null) {
      findings.push(
        `${filePath}:${lineOf(sourceText, start + mutableTraversal.index)}: confined enumeration must use indexed traversal`,
      );
    }
    const requiredControls = [
      [
        'private entry provenance',
        /\bsecurityWeakMapGet\s*\(\s*confinedFileSystemEntryProvenance\s*,/u,
      ],
      [
        'dense entry commit',
        /\bsecurityDefineProperty\s*\(\s*output\s*,\s*output\s*\.\s*length\s*,/u,
      ],
      ['lexical lstat classification', /\bfileSystemLstat\s*\(\s*candidate\s*\)/u],
      ['symlink rejection', /\bfileSystemStatsIsSymbolicLink\s*\(\s*lexicalStat\s*\)/u],
      ['canonical containment', /\bcontainsPath\s*\(\s*root\s*,\s*canonicalPath\s*\)/u],
      ['identity comparison', /\bsameFileSystemIdentity\s*\(/u],
      ['descriptor stat witness', /\bfileSystemStatFileDescriptor\s*\(\s*fileDescriptor\s*\)/u],
      ['descriptor byte read', /\bfileSystemReadFileDescriptor\s*\(\s*fileDescriptor\s*\)/u],
    ];
    for (let index = 0; index < requiredControls.length; index += 1) {
      const [label, pattern] = requiredControls[index];
      if (!pattern.test(authoritySource)) {
        findings.push(`${filePath}: identity-bound filesystem entries are missing ${label}`);
      }
    }
    if (
      !/\bentriesOf\s*\(\s*entry\s*:\s*ConfinedFileSystemEntry\s*\)/u.test(sourceText) ||
      !/\bfileBytesOf\s*\(\s*entry\s*:\s*ConfinedFileSystemEntry\s*\)/u.test(sourceText)
    ) {
      findings.push(
        `${filePath}: filesystem boundary must expose branded identity-bound entry operations`,
      );
    }
    return findings;
  }

  const start = sourceText.indexOf('async function writeNeutralPublicAssets');
  const end = sourceText.indexOf('function skipNeutralPublicAsset', start);
  if (start < 0 || end < 0) {
    return [`${filePath}: neutral public-asset copy authority region is missing`];
  }
  const authoritySource = sourceText.slice(start, end);
  const scanText = stripCommentsAndStrings(authoritySource);
  const mutablePatterns = [
    ['raw directory enumeration', /\breaddir\s*\(/u],
    ['mutable iterator traversal', /\bfor\s*\(\s*const\s+[^)]*\sof\s/u],
    ['mutable Dirent classification', /\.\s*(?:isDirectory|isFile|isSymbolicLink)\s*\(/u],
    ['raw copy sink', /\bcopyFile\s*\(/u],
    ['raw directory sink', /\bmkdir\s*\(/u],
    ['mutable Promise catch', /\.\s*catch\s*\(/u],
  ];
  for (let index = 0; index < mutablePatterns.length; index += 1) {
    const [label, pattern] = mutablePatterns[index];
    const match = pattern.exec(scanText);
    if (match !== null) {
      findings.push(
        `${filePath}:${lineOf(sourceText, start + match.index)}: post-replay public assets must not use ${label}`,
      );
    }
  }
  const requiredControls = [
    [
      'pinned source boundary',
      /\bcreateFrameworkOutputFileSystemBoundary\s*\(\s*manifestDistDir\s*\)/u,
    ],
    ['pinned output boundary', /\bcreateFrameworkOutputFileSystemBoundary\s*\(\s*outDir\s*\)/u],
    ['directory entry snapshot', /\bsnapshotBuildArray\s*\(/u],
    ['identity-bound recursion', /\bsource\s*\.\s*entriesOf\s*\(\s*directory\s*\)/u],
    ['identity-bound file read', /\bsource\s*\.\s*fileBytesOf\s*\(\s*entry\s*\)/u],
    [
      'confined output write',
      /\boutput\s*\.\s*writeFile\s*\(\s*entry\s*\.\s*relativePath\s*,\s*bytes\s*\)/u,
    ],
    ['non-file rejection', /\bentry\s*\.\s*kind\s*!==\s*['"]file['"]/u],
  ];
  for (let index = 0; index < requiredControls.length; index += 1) {
    const [label, pattern] = requiredControls[index];
    if (!pattern.test(authoritySource)) {
      findings.push(`${filePath}: post-replay public-asset copy is missing ${label}`);
    }
  }
  return findings;
}

export function taskArrayCommitFindings(filePath, sourceText) {
  const findings = [];
  const scanText = stripCommentsAndStrings(sourceText);
  const mutableMethodCommit = /\.\s*push\s*\(/u.exec(scanText);
  if (mutableMethodCommit !== null) {
    findings.push(
      `${filePath}:${lineOf(sourceText, mutableMethodCommit.index)}: durable-task collections must not append through mutable Array.push`,
    );
  }
  const mutableIndexCommit =
    /\b[A-Za-z_$][\w$]*\s*\[\s*(?:\d+|[A-Za-z_$][\w$]*(?:\s*\.\s*length)?)\s*\]\s*=/u.exec(
      scanText,
    );
  if (mutableIndexCommit !== null) {
    findings.push(
      `${filePath}:${lineOf(sourceText, mutableIndexCommit.index)}: durable-task collections must not dispatch through inherited numeric setters`,
    );
  }

  if (filePath !== taskSecurityIntrinsicsFile) return findings;

  if (/\bnativeArrayPush\b/u.test(scanText)) {
    findings.push(
      `${filePath}: captured Array.push is not a safe task commit because it still performs prototype-visible [[Set]]`,
    );
  }
  const requiredControls = [
    [
      'descriptor-indexed array commit',
      /\bfunction\s+defineTaskArrayIndex\s*<[^>]+>\s*\([\s\S]*?\bwitnessDefineProperty\s*\(\s*values\s*,\s*index\s*,/u,
    ],
    [
      'taskArrayPush own-data delegation',
      /\bfunction\s+taskArrayPush\s*<[^>]+>\s*\([^)]*\)\s*:\s*void\s*\{\s*commitTaskArrayValue\s*\(/u,
    ],
    [
      'array registry snapshot commit',
      /\bcommitTaskArrayValue\s*\(\s*result\s*,[\s\S]*?\$\{label\} array snapshot/u,
    ],
    [
      'record registry snapshot commit',
      /\bcommitTaskArrayValue\s*\(\s*result\s*,[\s\S]*?\$\{label\} record snapshot/u,
    ],
    [
      'iterator snapshot commit',
      /\bcommitTaskArrayValue\s*\(\s*output\s*,[\s\S]*?\$\{label\} iterator snapshot/u,
    ],
    [
      'Promise.all result commit',
      /\bcommitTaskArrayIndex\s*\(\s*results\s*,\s*index\s*,\s*result\s*,/u,
    ],
  ];
  for (let index = 0; index < requiredControls.length; index += 1) {
    const [description, pattern] = requiredControls[index];
    if (!pattern.test(sourceText)) {
      findings.push(`${filePath}: durable-task collections are missing ${description}`);
    }
  }
  return findings;
}

export function responseSecurityArrayCommitFindings(filePath, sourceText) {
  const findings = [];
  const scanText = stripCommentsAndStrings(sourceText);

  if (filePath !== responseSecurityIntrinsicsFile) {
    const mutableCookieCommit = /\bparts\s*\.\s*push\s*\(/u.exec(scanText);
    if (mutableCookieCommit !== null) {
      findings.push(
        `${filePath}:${lineOf(sourceText, mutableCookieCommit.index)}: cookie attributes must commit through securityArrayPush()`,
      );
    }
    if (!/\bsecurityArrayPush\s*\(\s*parts\s*,\s*['"]HttpOnly['"]\s*\)/u.test(sourceText)) {
      findings.push(`${filePath}: the HttpOnly cookie floor must use the response array choke`);
    }
    return findings;
  }

  if (/\bnativeArrayPush\b/u.test(scanText)) {
    findings.push(
      `${filePath}: captured Array.push is not a safe response commit because it still performs prototype-visible [[Set]]`,
    );
  }
  const requiredControls = [
    [
      'boot-pinned property definition',
      /\bconst\s+nativeObjectDefineProperty\s*=\s*NativeObject\s*\.\s*defineProperty\s*;/u,
    ],
    [
      'descriptor-indexed response commit',
      /\bfunction\s+defineResponseArrayIndex\s*<[^>]+>\s*\([\s\S]*?\bapply\s*\(\s*nativeObjectDefineProperty\s*,\s*NativeObject\s*,/u,
    ],
    [
      'securityArrayPush own-data delegation',
      /\bfunction\s+securityArrayPush\s*<[^>]+>\s*\([^)]*\)\s*:\s*void\s*\{\s*commitResponseArrayValue\s*\(/u,
    ],
    [
      'entropy replay-ledger commit',
      /\bsecurityArrayPush\s*\(\s*recentEntropyOrder\s*,\s*key\s*\)/u,
    ],
  ];
  for (let index = 0; index < requiredControls.length; index += 1) {
    const [description, pattern] = requiredControls[index];
    if (!pattern.test(sourceText)) {
      findings.push(`${filePath}: response security arrays are missing ${description}`);
    }
  }
  return findings;
}

export function egressArrayCommitFindings(filePath, sourceText) {
  const findings = [];
  const scanText = stripCommentsAndStrings(sourceText);
  const mutableMethodCommit = /\.\s*push\s*\(/u.exec(scanText);
  if (mutableMethodCommit !== null) {
    findings.push(
      `${filePath}:${lineOf(sourceText, mutableMethodCommit.index)}: egress authority arrays must not append through mutable Array.push`,
    );
  }
  const mutableIndexCommit =
    /\b[A-Za-z_$][\w$]*\s*\[\s*(?:\d+|[a-z_$][\w$]*(?:\s*\.\s*length)?)\s*\]\s*=(?!=)/u.exec(
      scanText,
    );
  if (mutableIndexCommit !== null) {
    findings.push(
      `${filePath}:${lineOf(sourceText, mutableIndexCommit.index)}: egress authority arrays must not dispatch through inherited numeric setters`,
    );
  }

  if (filePath !== egressSecurityIntrinsicsFile) return findings;

  if (/\bnativeArrayPush\b/u.test(scanText)) {
    findings.push(
      `${filePath}: captured Array.push is not a safe egress commit because it still performs prototype-visible [[Set]]`,
    );
  }
  const requiredControls = [
    [
      'boot-pinned property definition',
      /\bconst\s+nativeObjectDefineProperty\s*=\s*NativeObject\s*\.\s*defineProperty\s*;/u,
    ],
    [
      'descriptor-indexed egress commit',
      /\bfunction\s+defineEgressArrayIndex\s*<[^>]+>\s*\([\s\S]*?\bapply\s*\(\s*nativeObjectDefineProperty\s*,\s*NativeObject\s*,/u,
    ],
    [
      'own-data item snapshot',
      /\bfunction\s+commitEgressArrayItems\s*<[^>]+>\s*\([\s\S]*?\bnativeObjectGetOwnPropertyDescriptor\b[\s\S]*?\bdefineEgressArrayIndex\s*\(/u,
    ],
    [
      'egressArrayPush own-data delegation',
      /\bfunction\s+egressArrayPush\s*<[^>]+>\s*\([^)]*\)\s*:\s*number\s*\{[\s\S]*?\bcommitEgressArrayItems\s*\(\s*value\s*,\s*items\s*,/u,
    ],
    [
      'splice-argument own-data delegation',
      /\bfunction\s+egressArraySplice\s*<[^>]+>\s*\([\s\S]*?\bcommitEgressArrayItems\s*\(\s*args\s*,\s*items\s*,\s*['"]egress splice arguments['"]\s*\)/u,
    ],
  ];
  for (let index = 0; index < requiredControls.length; index += 1) {
    const [description, pattern] = requiredControls[index];
    if (!pattern.test(sourceText)) {
      findings.push(`${filePath}: egress security arrays are missing ${description}`);
    }
  }
  return findings;
}

export function presetRetentionPolicyFindings(filePath, sourceText) {
  const scanText = stripCommentsAndStrings(sourceText);
  const findings = [];
  const mutableClassification =
    /\bbuild\s*\.\s*clientModules\s*\.\s*(?:every|filter|find|findIndex|forEach|map|reduce|some)\s*\(/u.exec(
      scanText,
    );
  if (mutableClassification !== null) {
    findings.push(
      `${filePath}:${lineOf(sourceText, mutableClassification.index)}: deploy-skew retention policy must not classify client modules through mutable collection methods`,
    );
  }
  if (!/\bsnapshotBuildArray\s*\(\s*build\s*\.\s*clientModules\s*,/u.test(scanText)) {
    findings.push(
      `${filePath}: deploy-skew retention policy must snapshot the complete emitted client-module ledger`,
    );
  }
  if (
    !/\bfor\s*\(\s*let\s+[A-Za-z_$][\w$]*\s*=\s*0\s*;[^;]*<\s*clientModules\s*\.\s*length\s*;[^)]*\+=\s*1\s*\)/u.test(
      scanText,
    )
  ) {
    findings.push(
      `${filePath}: deploy-skew retention policy must classify pinned client modules with indexed traversal`,
    );
  }
  return findings;
}

export function presetDiagnosticAggregationFindings(filePath, sourceText) {
  const scanText = stripCommentsAndStrings(sourceText);
  const findings = [];
  const mutableAppend = /\bdiagnostics\s*\.\s*push\s*\(/u.exec(scanText);
  if (mutableAppend !== null) {
    findings.push(
      `${filePath}:${lineOf(sourceText, mutableAppend.index)}: preset diagnostics must not append through mutable Array.push`,
    );
  }
  const mutableSpread =
    /\.\.\.\s*(?:clientModuleRetentionDiagnostics\s*\(|missingJobRunnerDiagnostics\s*\(|retentionDiagnostics\b|jobRunnerDiagnostics\b)/u.exec(
      scanText,
    );
  if (mutableSpread !== null) {
    findings.push(
      `${filePath}:${lineOf(sourceText, mutableSpread.index)}: preset diagnostic aggregation must not dispatch through mutable iterator spread`,
    );
  }
  const mutableTaskList = /\bbuild\s*\.\s*tasks\s*\.\s*map\s*\(/u.exec(scanText);
  if (mutableTaskList !== null) {
    findings.push(
      `${filePath}:${lineOf(sourceText, mutableTaskList.index)}: preset task diagnostics must snapshot tasks and build their key list with indexed traversal`,
    );
  }
  const mutablePromise = /\b(?:runnerDiagnostics|source)\s*\.\s*then\s*\(/u.exec(scanText);
  if (mutablePromise !== null) {
    findings.push(
      `${filePath}:${lineOf(sourceText, mutablePromise.index)}: preset inspection must not chain through mutable Promise.prototype.then`,
    );
  }
  const mutableBlockedModuleTraversal =
    /\bfor\s*\(\s*const\s+[A-Za-z_$][\w$]*\s+of\s+cloudflareBlockedNodeModules\s*\)/u.exec(
      scanText,
    );
  if (mutableBlockedModuleTraversal !== null) {
    findings.push(
      `${filePath}:${lineOf(sourceText, mutableBlockedModuleTraversal.index)}: Cloudflare blocked-module classifiers must use a pinned snapshot and indexed traversal`,
    );
  }

  if (!/\bfunction\s+appendPresetDiagnostics\s*\(/u.test(scanText)) {
    findings.push(
      `${filePath}: built-in preset diagnostics must keep one boot-pinned aggregation helper`,
    );
  }
  if (!/\bcommitBuildArrayValue\s*\(\s*target\s*,\s*diagnostic\s*,/u.test(scanText)) {
    findings.push(
      `${filePath}: built-in preset diagnostics must commit through commitBuildArrayValue()`,
    );
  }
  if (!/\bsnapshotBuildArray\s*\(\s*build\s*\.\s*tasks\s*,/u.test(scanText)) {
    findings.push(`${filePath}: preset task diagnostics must snapshot the complete task ledger`);
  }
  if (!/\bsecurityRegExpTest\s*\(/u.test(scanText)) {
    findings.push(`${filePath}: preset source classifiers must use boot-pinned RegExp execution`);
  }
  if (!/\bsecurityPromiseThen\s*\(/u.test(scanText)) {
    findings.push(`${filePath}: async preset inspection must use boot-pinned Promise chaining`);
  }
  return findings;
}

export function cloudflareTomlAssemblyFindings(filePath, sourceText) {
  const scanText = stripCommentsAndStrings(sourceText);
  const findings = [];
  const mutableJoin = /\]\s*\.\s*join\s*\(/u.exec(scanText);
  if (mutableJoin !== null) {
    findings.push(
      `${filePath}:${lineOf(sourceText, mutableJoin.index)}: authoritative Wrangler TOML must not assemble through mutable Array.join`,
    );
  }
  if (!/\bfunction\s+snapshotCloudflarePresetOptions\s*\(/u.test(sourceText)) {
    findings.push(
      `${filePath}: Cloudflare preset values must snapshot through an own-data options boundary`,
    );
  }
  if (!/\bconst\s+lines\s*=\s*snapshotBuildArray\s*\(/u.test(sourceText)) {
    findings.push(`${filePath}: authoritative Wrangler TOML must snapshot every reviewed line`);
  }
  if (!/\bsecurityArrayJoin\s*\(\s*lines\s*,/u.test(sourceText)) {
    findings.push(
      `${filePath}: authoritative Wrangler TOML must use boot-pinned final composition`,
    );
  }
  return findings;
}

export function nodeRuntimePackageBoundaryFindings(filePath, sourceText) {
  const scanText = stripCommentsAndStrings(sourceText);
  const findings = [];
  const mutableParse = /\bJSON\s*\.\s*parse\s*\(/u.exec(scanText);
  if (mutableParse !== null) {
    findings.push(
      `${filePath}:${lineOf(sourceText, mutableParse.index)}: Node runtime package metadata must not parse through mutable JSON.parse`,
    );
  }
  const mutableLockfileTraversal = /\bfor\s*\(\s*const\s+fileName\s+of\s*\[/u.exec(scanText);
  if (mutableLockfileTraversal !== null) {
    findings.push(
      `${filePath}:${lineOf(sourceText, mutableLockfileTraversal.index)}: Node runtime lockfile selection must use a pinned inventory and indexed traversal`,
    );
  }
  if (!/\bsecurityJsonParse\s*\(/u.test(sourceText)) {
    findings.push(`${filePath}: Node runtime package metadata must use boot-pinned JSON parsing`);
  }
  if (!/\bfunction\s+snapshotNodeRuntimePackageManifest\s*\(/u.test(sourceText)) {
    findings.push(`${filePath}: Node runtime package metadata must cross an own-data snapshot`);
  }
  if (!/\bsecurityObjectKeys\s*\(/u.test(sourceText)) {
    findings.push(
      `${filePath}: Node runtime dependency names must use boot-pinned own-key capture`,
    );
  }
  if (!/\bsnapshotBuildArray\s*\(\s*runtimeLockfileNames\s*,/u.test(sourceText)) {
    findings.push(`${filePath}: Node runtime lockfile candidates must use a dense snapshot`);
  }
  if (
    !/\bfor\s*\(\s*let\s+[A-Za-z_$][\w$]*\s*=\s*0\s*;[^;]*<\s*fileNames\s*\.\s*length\s*;[^)]*\+=\s*1\s*\)/u.test(
      sourceText,
    )
  ) {
    findings.push(`${filePath}: Node runtime lockfile candidates must use indexed traversal`);
  }
  return findings;
}

export function main(options = {}) {
  const result = checkFilesystemBoundary(options);
  process.stdout.write(`check-filesystem-boundary/v1 ${result.summary}\n`);
  for (const finding of result.findings) process.stderr.write(`${finding}\n`);
  return result.ok;
}

function* rawFileSystemImports(sourceText) {
  const regex =
    /\b(?:import\s+(?:[^'"]+\s+from\s+)?|await\s+import\s*\(\s*)['"](?<moduleName>node:fs(?:\/promises)?|fs(?:\/promises)?)['"]/gu;
  for (const match of sourceText.matchAll(regex)) {
    yield { index: match.index ?? 0, moduleName: match.groups?.moduleName ?? 'node:fs' };
  }
}

function* rawLateBoundBoundaryImports(sourceText) {
  const regex =
    /\b(?:import\s+(?:[^'"]+\s+from\s+)?|await\s+import\s*\(\s*)['"](?<moduleName>node:(?:crypto|path|stream))['"]/gu;
  for (const match of sourceText.matchAll(regex)) {
    yield { index: match.index ?? 0, moduleName: match.groups?.moduleName ?? 'node:path' };
  }
}

function usesPathConfinementPrimitive(sourceText, importedPathNames) {
  return firstPathPrimitiveIndex(sourceText, importedPathNames) >= 0;
}

function firstPathPrimitiveIndex(sourceText, importedPathNames = new Set()) {
  const namedAlternation = [...importedPathNames].map(escapeRegExp).join('|');
  const patterns = [
    /\bpath\.(?:resolve|relative|normalize|isAbsolute)\s*\(/u,
    ...(namedAlternation === '' ? [] : [new RegExp(`\\b(?:${namedAlternation})\\s*\\(`, 'u')]),
  ];
  const indexes = patterns
    .map((pattern) => sourceText.search(pattern))
    .filter((index) => index >= 0);
  return indexes.length === 0 ? -1 : Math.min(...indexes);
}

function pathPrimitiveImportNames(sourceText) {
  const names = new Set();
  const importPattern = /\bimport\s+\{(?<imports>[^}]+)\}\s+from\s+['"]node:path['"]/gu;
  for (const match of sourceText.matchAll(importPattern)) {
    for (const part of (match.groups?.imports ?? '').split(',')) {
      const [imported, local] = part.trim().split(/\s+as\s+/u);
      if (['resolve', 'relative', 'normalize', 'isAbsolute'].includes(imported)) {
        names.add(local ?? imported);
      }
    }
  }
  return names;
}

function escapeRegExp(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&');
}

function stripCommentsAndStrings(sourceText) {
  let result = '';
  let index = 0;
  while (index < sourceText.length) {
    const char = sourceText[index];
    const next = sourceText[index + 1];
    if (char === '/' && next === '/') {
      const end = sourceText.indexOf('\n', index + 2);
      const stop = end === -1 ? sourceText.length : end;
      result += spacesPreservingNewlines(sourceText.slice(index, stop));
      index = stop;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = sourceText.indexOf('*/', index + 2);
      const stop = end === -1 ? sourceText.length : end + 2;
      result += spacesPreservingNewlines(sourceText.slice(index, stop));
      index = stop;
      continue;
    }
    if (char === '"' || char === "'") {
      const { text, nextIndex } = stripQuotedString(sourceText, index, char);
      result += text;
      index = nextIndex;
      continue;
    }
    if (char === '`') {
      const { text, nextIndex } = stripTemplateString(sourceText, index);
      result += text;
      index = nextIndex;
      continue;
    }
    result += char;
    index += 1;
  }
  return result;
}

function stripQuotedString(sourceText, start, quote) {
  let index = start + 1;
  while (index < sourceText.length) {
    if (sourceText[index] === '\\') {
      index += 2;
      continue;
    }
    if (sourceText[index] === quote) {
      index += 1;
      break;
    }
    index += 1;
  }
  return { nextIndex: index, text: spacesPreservingNewlines(sourceText.slice(start, index)) };
}

function stripTemplateString(sourceText, start) {
  let result = '`';
  let index = start + 1;
  while (index < sourceText.length) {
    const char = sourceText[index];
    const next = sourceText[index + 1];
    if (char === '\\') {
      result += '  ';
      index += 2;
      continue;
    }
    if (char === '`') {
      result += '`';
      index += 1;
      break;
    }
    if (char === '$' && next === '{') {
      const expression = readTemplateExpression(sourceText, index + 2);
      result += '${' + stripCommentsAndStrings(expression.text) + '}';
      index = expression.nextIndex;
      continue;
    }
    result += char === '\n' ? '\n' : ' ';
    index += 1;
  }
  return { nextIndex: index, text: result };
}

function readTemplateExpression(sourceText, start) {
  let depth = 1;
  let index = start;
  while (index < sourceText.length && depth > 0) {
    const char = sourceText[index];
    if (char === '"' || char === "'") {
      index = stripQuotedString(sourceText, index, char).nextIndex;
      continue;
    }
    if (char === '`') {
      index = stripTemplateString(sourceText, index).nextIndex;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    index += 1;
  }
  return { nextIndex: index, text: sourceText.slice(start, Math.max(start, index - 1)) };
}

function spacesPreservingNewlines(value) {
  return value.replace(/[^\n]/gu, ' ');
}

function lineOf(sourceText, index) {
  return sourceText.slice(0, index).split('\n').length;
}

if (isMainEntry(import.meta.url)) await runGate(main);
