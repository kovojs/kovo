#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  generatedEntrySubpaths,
  internalEntrySubpaths,
  publicEntrySubpaths,
  publicPackages,
  repoRoot,
} from './public-packages.mjs';

export const PACKAGE_FRONT_DOOR_SCHEMA = 'kovo-package-front-door/v1';

function importSpecifier(packageName, subpath) {
  return subpath === '.' ? packageName : `${packageName}/${subpath.replace(/^\.\//, '')}`;
}

function packageForSpecifier(packages, specifier) {
  return packages
    .filter((pkg) => specifier === pkg.name || specifier.startsWith(`${pkg.name}/`))
    .sort((left, right) => right.name.length - left.name.length)[0];
}

function readmeImportSpecifiers(markdown) {
  return [
    ...markdown.matchAll(
      /(?:\bfrom\s+|\bimport\s*\(|\brequire\s*\()\s*['"](@kovojs\/[^'"]+)['"]/gu,
    ),
  ].map((match) => match[1]);
}

function authoredRoutes(directory, prefix) {
  if (!existsSync(directory)) return [];
  return readFileTree(directory)
    .filter((file) => file.endsWith('.md'))
    .map((file) => `/${prefix}/${path.basename(file, '.md')}/`);
}

function readFileTree(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? readFileTree(file) : [file];
  });
}

function knownSiteRoutes(packages) {
  return new Set([
    ...authoredRoutes(path.join(repoRoot, 'site/content/guides'), 'guides'),
    ...authoredRoutes(path.join(repoRoot, 'site/content/getting-started'), 'getting-started'),
    ...authoredRoutes(path.join(repoRoot, 'site/content/tutorial'), 'tutorial'),
    ...packages.filter((pkg) => pkg.apiRef).map((pkg) => `/api/${pkg.apiRef.slug}/`),
    '/api/create-kovo/',
  ]);
}

export function collectPackageFrontDoorFindings({
  packages = publicPackages(),
  root = repoRoot,
} = {}) {
  const findings = [];
  const siteRoutes = knownSiteRoutes(packages);
  const publicImports = new Set(
    packages.flatMap((pkg) =>
      publicEntrySubpaths(pkg).map((subpath) => importSpecifier(pkg.name, subpath)),
    ),
  );
  const forbiddenImports = new Set(
    packages.flatMap((pkg) =>
      [...generatedEntrySubpaths(pkg), ...internalEntrySubpaths(pkg)].map((subpath) =>
        importSpecifier(pkg.name, subpath),
      ),
    ),
  );

  for (const pkg of packages) {
    const readmePath = path.join(root, 'packages', pkg.dir, 'README.md');
    const label = `packages/${pkg.dir}/README.md`;
    if (!existsSync(readmePath)) {
      findings.push(`${label}: missing package front door`);
      continue;
    }
    const markdown = readFileSync(readmePath, 'utf8');
    if (!markdown.startsWith(`# ${pkg.name}\n`)) {
      findings.push(`${label}: first heading must be "# ${pkg.name}"`);
    }
    if (/\]\(\.\/src\//u.test(markdown)) {
      findings.push(`${label}: packed README links to unpublished ./src content`);
    }
    if (/\bpublic-packages\.json\b|\bscripts\//u.test(markdown)) {
      findings.push(`${label}: package front door exposes repository-internal guidance`);
    }

    for (const specifier of readmeImportSpecifiers(markdown)) {
      const importedPackage = packageForSpecifier(packages, specifier);
      if (!importedPackage) {
        findings.push(`${label}: imports unclassified Kovo package ${specifier}`);
      } else if (!publicImports.has(specifier) || forbiddenImports.has(specifier)) {
        findings.push(`${label}: imports non-app-public entry ${specifier}`);
      }
    }

    if (pkg.apiRef && !markdown.includes(`/api/${pkg.apiRef.slug}/`)) {
      findings.push(`${label}: missing generated API landing /api/${pkg.apiRef.slug}/`);
    }
    for (const match of markdown.matchAll(
      /`(\/(?:api|guides|getting-started|tutorial)\/[^`#?]*\/)`/gu,
    )) {
      const route = match[1];
      if (!siteRoutes.has(route)) findings.push(`${label}: references missing site route ${route}`);
    }
  }

  return findings.sort();
}

export function checkPackageFrontDoors(options = {}) {
  const findings = collectPackageFrontDoorFindings(options);
  if (findings.length > 0) {
    throw new Error(
      `${PACKAGE_FRONT_DOOR_SCHEMA} FAIL findings=${findings.length}\n${findings
        .map((finding) => `- ${finding}`)
        .join('\n')}`,
    );
  }
  process.stdout.write(
    `${PACKAGE_FRONT_DOOR_SCHEMA} packages=${(options.packages ?? publicPackages()).length} OK\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkPackageFrontDoors();
}
