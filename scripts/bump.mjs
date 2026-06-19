#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../', import.meta.url));

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parseSemver(version) {
  const match = SEMVER_PATTERN.exec(version);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
    build: match[5] ?? '',
  };
}

function compareIdentifier(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    return Number(left) - Number(right);
  }
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function compareSemver(left, right) {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);
  if (!parsedLeft) throw new Error(`Invalid semver: ${left}`);
  if (!parsedRight) throw new Error(`Invalid semver: ${right}`);

  for (const key of ['major', 'minor', 'patch']) {
    const delta = parsedLeft[key] - parsedRight[key];
    if (delta !== 0) return delta;
  }

  const leftPre = parsedLeft.prerelease;
  const rightPre = parsedRight.prerelease;
  if (leftPre.length === 0 && rightPre.length === 0) return 0;
  if (leftPre.length === 0) return 1;
  if (rightPre.length === 0) return -1;

  const count = Math.max(leftPre.length, rightPre.length);
  for (let index = 0; index < count; index += 1) {
    if (leftPre[index] === undefined) return -1;
    if (rightPre[index] === undefined) return 1;
    const delta = compareIdentifier(leftPre[index], rightPre[index]);
    if (delta !== 0) return delta;
  }
  return 0;
}

function readPackageJson(packagePath) {
  return JSON.parse(readFileSync(packagePath, 'utf8'));
}

function workspacePatterns(rootPackage) {
  if (Array.isArray(rootPackage.workspaces)) {
    return rootPackage.workspaces;
  }
  if (Array.isArray(rootPackage.workspaces?.packages)) {
    return rootPackage.workspaces.packages;
  }
  return [];
}

function expandWorkspacePattern(cwd, pattern) {
  if (!pattern.includes('*')) {
    return existsSync(path.join(cwd, pattern, 'package.json')) ? [path.join(pattern, 'package.json')] : [];
  }

  if (!pattern.endsWith('/*') || pattern.indexOf('*') !== pattern.length - 1) {
    throw new Error(`Unsupported workspace pattern: ${pattern}`);
  }

  const base = pattern.slice(0, -2);
  const basePath = path.join(cwd, base);
  if (!existsSync(basePath)) return [];

  return readdirSync(basePath)
    .filter((entry) => {
      const packagePath = path.join(basePath, entry, 'package.json');
      return statSync(path.join(basePath, entry)).isDirectory() && existsSync(packagePath);
    })
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => path.join(base, entry, 'package.json'));
}

export function discoverPackageJsonPaths({ cwd = repoRoot } = {}) {
  const rootPackagePath = path.join(cwd, 'package.json');
  const rootPackage = readPackageJson(rootPackagePath);
  const paths = ['package.json'];

  for (const pattern of workspacePatterns(rootPackage)) {
    for (const packagePath of expandWorkspacePattern(cwd, pattern)) {
      if (!paths.includes(packagePath)) {
        paths.push(packagePath);
      }
    }
  }

  return paths;
}

export function packageRows({ cwd = repoRoot } = {}) {
  return discoverPackageJsonPaths({ cwd }).map((packagePath) => {
    const manifest = readPackageJson(path.join(cwd, packagePath));
    return {
      path: packagePath,
      name: manifest.name ?? '(unnamed)',
      version: typeof manifest.version === 'string' ? manifest.version : null,
      private: manifest.private === true,
    };
  });
}

function formatRows(rows) {
  const columns = [
    ['Package', ...rows.map((row) => row.name)],
    ['Version', ...rows.map((row) => row.version ?? '(none)')],
    ['Private', ...rows.map((row) => (row.private ? 'yes' : 'no'))],
    ['Path', ...rows.map((row) => row.path)],
  ];
  const widths = columns.map((column) => Math.max(...column.map((cell) => cell.length)));
  const header = columns.map((column, index) => column[0].padEnd(widths[index])).join('  ');
  const divider = widths.map((width) => '-'.repeat(width)).join('  ');
  const body = rows
    .map((_, rowIndex) =>
      columns.map((column, columnIndex) => column[rowIndex + 1].padEnd(widths[columnIndex])).join('  '),
    )
    .join('\n');
  return `${header}\n${divider}\n${body}`;
}

function git(args, { cwd = repoRoot, stdio = 'pipe' } = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio });
}

function assertCleanPackageFiles(packagePaths, { cwd = repoRoot } = {}) {
  try {
    git(['diff', '--quiet', '--', ...packagePaths], { cwd });
    git(['diff', '--cached', '--quiet', '--', ...packagePaths], { cwd });
  } catch {
    const status = git(['status', '--short', '--', ...packagePaths], { cwd });
    throw new Error(
      `Refusing to bump because package files already have uncommitted changes:\n${status.trimEnd()}`,
    );
  }
}

function highestVersion(rows) {
  const versionedRows = rows.filter((row) => row.version !== null);
  if (versionedRows.length === 0) {
    throw new Error('No package.json files with a version field were found.');
  }

  return versionedRows.reduce((highest, row) => {
    if (!parseSemver(row.version)) {
      throw new Error(`${row.path} has an invalid current semver version: ${row.version}`);
    }
    return compareSemver(row.version, highest.version) > 0 ? row : highest;
  });
}

function assertHigherVersion(nextVersion, rows) {
  if (!parseSemver(nextVersion)) {
    throw new Error(`Expected a valid semver version like 0.2.0; received: ${nextVersion}`);
  }

  const highest = highestVersion(rows);
  if (compareSemver(nextVersion, highest.version) <= 0) {
    throw new Error(
      `Expected a version higher than the current highest package version (${highest.version} in ${highest.path}); received: ${nextVersion}`,
    );
  }
}

function writeBumpedPackages(rows, nextVersion, { cwd = repoRoot } = {}) {
  const updatedPaths = [];
  for (const row of rows) {
    if (row.version === null) continue;
    const absolutePath = path.join(cwd, row.path);
    const manifest = readPackageJson(absolutePath);
    manifest.version = nextVersion;
    writeFileSync(absolutePath, `${JSON.stringify(manifest, null, 2)}\n`);
    updatedPaths.push(row.path);
  }
  return updatedPaths;
}

function commitPackageChanges(packagePaths, nextVersion, { cwd = repoRoot } = {}) {
  git(['add', '--', ...packagePaths], { cwd });
  git(['commit', '--only', '-m', `Bump to version ${nextVersion}`, '--', ...packagePaths], {
    cwd,
    stdio: 'inherit',
  });
  return git(['rev-parse', '--short', 'HEAD'], { cwd }).trim();
}

async function requestedVersion(args) {
  if (args.includes('--help') || args.includes('-h')) {
    return { help: true };
  }
  if (args.length > 1) {
    throw new Error('Usage: npm run bump -- <version>');
  }
  if (args[0]) {
    return { version: args[0] };
  }

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question('New version: ');
    return { version: answer.trim() };
  } finally {
    rl.close();
  }
}

export async function runBump({ cwd = repoRoot, args = process.argv.slice(2) } = {}) {
  const rows = packageRows({ cwd });
  process.stdout.write(`Current package versions:\n${formatRows(rows)}\n\n`);

  const request = await requestedVersion(args);
  if (request.help) {
    process.stdout.write('Usage: npm run bump -- <version>\n');
    return 0;
  }

  const nextVersion = request.version;
  assertHigherVersion(nextVersion, rows);

  const versionedPaths = rows.filter((row) => row.version !== null).map((row) => row.path);
  assertCleanPackageFiles(versionedPaths, { cwd });

  const updatedPaths = writeBumpedPackages(rows, nextVersion, { cwd });
  const commit = commitPackageChanges(updatedPaths, nextVersion, { cwd });
  process.stdout.write(`\nUpdated ${updatedPaths.length} package.json files and committed ${commit}.\n`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBump().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
