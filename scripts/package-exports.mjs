import path from 'node:path';
import {
  computeIconPlan,
  iconSourceTargetForSubpath,
} from '../packages/icons/scripts/icon-plan.mjs';

export const SOURCE_EXPORT_CONDITIONS = ['source', 'development', 'import', 'default', 'types'];

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isConditionalExportTarget(value) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => !key.startsWith('.'));
}

export function normalizePackageExports(exportsMap = {}) {
  if (
    typeof exportsMap === 'string' ||
    Array.isArray(exportsMap) ||
    isConditionalExportTarget(exportsMap)
  ) {
    return { '.': exportsMap };
  }
  if (!isRecord(exportsMap)) return {};
  return exportsMap;
}

export function normalizePackageBin(bin) {
  if (typeof bin === 'string') return new Map([['', bin]]);
  if (!isRecord(bin)) return new Map();
  return new Map(Object.entries(bin));
}

export function isSourceTarget(value) {
  return typeof value === 'string' && /^\.\/src\/.+\.tsx?$/.test(value);
}

export function resolveExportTarget(
  target,
  { conditions = SOURCE_EXPORT_CONDITIONS, sourceOnly = false } = {},
) {
  if (typeof target === 'string') {
    return !sourceOnly || isSourceTarget(target) ? target : null;
  }

  if (Array.isArray(target)) {
    for (const candidate of target) {
      const resolved = resolveExportTarget(candidate, { conditions, sourceOnly });
      if (resolved !== null) return resolved;
    }
    return null;
  }

  if (!isRecord(target)) return null;

  for (const condition of conditions) {
    if (!Object.hasOwn(target, condition)) continue;
    const resolved = resolveExportTarget(target[condition], { conditions, sourceOnly });
    if (resolved !== null) return resolved;
  }

  for (const value of Object.values(target)) {
    const resolved = resolveExportTarget(value, { conditions, sourceOnly });
    if (resolved !== null) return resolved;
  }
  return null;
}

export function resolveSourceExportTarget(target, options = {}) {
  return resolveExportTarget(target, { ...options, sourceOnly: true });
}

/** A source entry like `./src/api/app-shell/core.ts` -> `api/app-shell/core`. */
export function sourceStem(srcPath) {
  const normalized = srcPath.replace(/^\.\//, '');
  const match = /^src\/(.+)\.tsx?$/.exec(normalized);
  if (!match) {
    throw new Error(`expected a ./src/<path>.ts(x) target, got: ${srcPath}`);
  }
  return match[1];
}

export function importPathForPackageSubpath(packageName, subpath) {
  return subpath === '.' ? packageName : `${packageName}/${subpath.slice(2)}`;
}

export function sourceExportEntriesForPackage({
  packageDir,
  packageJson,
  packagesRoot,
  repoRoot,
  tierForSubpath,
}) {
  if (packageJson.name === '@kovojs/icons') {
    const plan = computeIconPlan();
    return plan.publicSubpaths.map((subpath) => {
      const resolved = iconSourceTargetForSubpath(subpath);
      const absPath = path.join(packagesRoot, packageDir, resolved);
      return {
        packageName: packageJson.name,
        packageDir,
        subpath,
        importPath: importPathForPackageSubpath(packageJson.name, subpath),
        source: path.relative(repoRoot, absPath),
        absPath,
        target: resolved,
        ...(tierForSubpath ? { tier: tierForSubpath(subpath) } : {}),
      };
    });
  }

  const entries = [];
  for (const [subpath, target] of Object.entries(normalizePackageExports(packageJson.exports))) {
    const resolved = resolveSourceExportTarget(target);
    if (resolved === null) continue;
    const absPath = path.join(packagesRoot, packageDir, resolved);
    entries.push({
      packageName: packageJson.name,
      packageDir,
      subpath,
      importPath: importPathForPackageSubpath(packageJson.name, subpath),
      source: path.relative(repoRoot, absPath),
      absPath,
      target: resolved,
      ...(tierForSubpath ? { tier: tierForSubpath(subpath) } : {}),
    });
  }
  return entries;
}

export function declaredPackageExportSubpaths(packageJson) {
  if (packageJson.name === '@kovojs/icons') {
    return computeIconPlan().publicSubpaths;
  }
  return Object.keys(normalizePackageExports(packageJson.exports));
}
