import * as path from 'node:path';

import {
  StaticExportError,
  staticExportDiagnostic,
} from './static-export-diagnostics.js';
import {
  type StaticExportArtifact,
  type StaticExportAssetArtifact,
  type StaticExportClientModuleArtifact,
} from './static-export-types.js';

export type StaticExportOutputPlanItemKind = 'client-module' | 'route-document' | 'static-asset';

export interface StaticExportOutputPlanItem {
  kind: StaticExportOutputPlanItemKind;
  path: string;
  targetPath: string;
}

export interface StaticExportOutputTarget {
  diagnosticPath: string;
  itemIndex: number;
  itemKind: StaticExportOutputPlanItemKind;
  kind: string;
  targetPath: string;
}

interface StaticExportOutputTargetArtifacts {
  artifacts: readonly StaticExportArtifact[];
  assets: readonly StaticExportAssetArtifact[];
  clientModules: readonly StaticExportClientModuleArtifact[];
}

export function staticExportOutputTargets(
  plan: StaticExportOutputTargetArtifacts,
  root: string,
): StaticExportOutputTarget[] {
  const targets: StaticExportOutputTarget[] = [];

  plan.artifacts.forEach((artifact, itemIndex) => {
    targets.push({
      diagnosticPath: artifact.path,
      itemIndex,
      itemKind: 'route-document',
      kind: 'route document',
      targetPath: staticExportArtifactTargetPath(root, artifact.path),
    });
  });

  plan.clientModules.forEach((artifact, itemIndex) => {
    targets.push({
      diagnosticPath: artifact.path,
      itemIndex,
      itemKind: 'client-module',
      kind: 'client module',
      targetPath: staticExportClientModuleTargetPath(root, artifact.path),
    });
  });

  plan.assets.forEach((artifact, itemIndex) => {
    targets.push({
      diagnosticPath: artifact.path,
      itemIndex,
      itemKind: 'static-asset',
      kind: 'static asset',
      targetPath: staticExportAssetTargetPath(root, artifact.path),
    });
  });

  assertNoStaticExportOutputConflicts(targets);
  return targets;
}

function assertNoStaticExportOutputConflicts(targets: readonly StaticExportOutputTarget[]): void {
  const seen = new Map<string, StaticExportOutputTarget>();

  for (const target of targets) {
    const existing = seen.get(target.targetPath);
    if (existing) {
      throw new StaticExportError([
        staticExportDiagnostic(
          target.diagnosticPath,
          `FW229 static export cannot write ${target.kind} '${target.diagnosticPath}' because it conflicts with ${existing.kind} '${existing.diagnosticPath}'.`,
        ),
      ]);
    }

    seen.set(target.targetPath, target);
  }
}

function staticExportArtifactTargetPath(root: string, artifactPath: string): string {
  const targetPath = path.resolve(root, artifactPath.replace(/^\/+/, ''));
  if (targetPath === root || targetPath.startsWith(`${root}${path.sep}`)) return targetPath;

  throw new StaticExportError([
    staticExportDiagnostic(
      artifactPath,
      `FW229 static export refused to write '${artifactPath}' outside the configured output directory.`,
    ),
  ]);
}

function staticExportClientModuleTargetPath(root: string, modulePath: string): string {
  const segments = modulePath.split('/').filter(Boolean).map(decodeClientModulePathSegment);
  const targetPath = path.resolve(root, ...segments);
  if (targetPath === root || targetPath.startsWith(`${root}${path.sep}`)) return targetPath;

  throw new StaticExportError([
    staticExportDiagnostic(
      modulePath,
      `FW229 static export refused to write client module '${modulePath}' outside the configured output directory.`,
    ),
  ]);
}

function decodeClientModulePathSegment(segment: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw new StaticExportError([
      staticExportDiagnostic(
        `/c/${segment}`,
        `FW229 static export cannot write client module path segment '${segment}' because it is not valid URL encoding.`,
      ),
    ]);
  }

  if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) {
    throw new StaticExportError([
      staticExportDiagnostic(
        `/c/${segment}`,
        `FW229 static export refused unsafe client module path segment '${segment}'.`,
      ),
    ]);
  }

  return decoded;
}

function staticExportAssetTargetPath(root: string, assetPath: string): string {
  const segments = assetPath.split('/').filter(Boolean).map(decodeStaticExportAssetPathSegment);
  if (segments.length === 0) {
    throw new StaticExportError([
      staticExportDiagnostic(
        assetPath,
        `FW229 static export refused static asset '${assetPath}' because it does not name an output file.`,
      ),
    ]);
  }

  const targetPath = path.resolve(root, ...segments);
  if (targetPath === root || targetPath.startsWith(`${root}${path.sep}`)) return targetPath;

  throw new StaticExportError([
    staticExportDiagnostic(
      assetPath,
      `FW229 static export refused to write static asset '${assetPath}' outside the configured output directory.`,
    ),
  ]);
}

function decodeStaticExportAssetPathSegment(segment: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw new StaticExportError([
      staticExportDiagnostic(
        segment,
        `FW229 static export cannot write static asset path segment '${segment}' because it is not valid URL encoding.`,
      ),
    ]);
  }

  if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) {
    throw new StaticExportError([
      staticExportDiagnostic(
        segment,
        `FW229 static export refused unsafe static asset path segment '${segment}'.`,
      ),
    ]);
  }

  return decoded;
}
