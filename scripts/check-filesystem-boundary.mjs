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
export const presetRetentionPolicyFile = 'packages/server/src/build.ts';

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
