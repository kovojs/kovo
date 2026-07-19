const packageEntryIndent = '  ';
const packageFieldIndent = '    ';
const sha512IntegrityPattern = /^sha512-[A-Za-z0-9+/]{86}==$/u;

/**
 * Parse the integrity-bearing `packages` map from a pnpm v9 lockfile.
 *
 * This deliberately implements only the closed shape Kovo relies on instead of loading a YAML
 * package whose own bytes would have to be trusted before this bootstrap check can run. Unknown
 * package fields are ignored, but duplicate package keys, duplicate resolution rows, and malformed
 * integrity values are rejected rather than guessed through.
 */
export function parsePnpmPackageIntegrities(
  lockfileText,
  { lockfilePath = 'pnpm-lock.yaml' } = {},
) {
  const findings = [];
  const packages = new Map();
  const lines = lockfileText.split(/\r?\n/u);
  let inPackages = false;
  let sawPackages = false;
  let current;

  const finishCurrent = () => {
    if (!current) return;
    if (packages.has(current.key)) {
      findings.push(`${lockfilePath}:${current.line}: duplicate packages entry ${current.key}`);
    } else {
      packages.set(current.key, {
        integrity: current.integrity,
        line: current.line,
      });
    }
    current = undefined;
  };

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (!inPackages) {
      if (line === 'packages:') {
        if (sawPackages) findings.push(`${lockfilePath}:${lineNumber}: duplicate packages map`);
        sawPackages = true;
        inPackages = true;
      }
      continue;
    }

    if (line !== '' && !line.startsWith(' ')) {
      finishCurrent();
      inPackages = false;
      continue;
    }

    if (line.startsWith(packageEntryIndent) && !line.startsWith(packageFieldIndent)) {
      finishCurrent();
      const key = parsePackageEntryKey(line, lineNumber, lockfilePath, findings);
      if (key !== undefined) current = { integrity: undefined, key, line: lineNumber };
      continue;
    }

    if (!current || !line.startsWith(`${packageFieldIndent}resolution:`)) continue;
    if (current.sawResolution) {
      findings.push(`${lockfilePath}:${lineNumber}: duplicate resolution for ${current.key}`);
      continue;
    }
    current.sawResolution = true;
    const value = line.slice(`${packageFieldIndent}resolution:`.length).trim();
    const integrity = parseFlowResolutionIntegrity(value);
    if (integrity === undefined) {
      findings.push(
        `${lockfilePath}:${lineNumber}: ${current.key} resolution must be a flow map with one integrity field`,
      );
      continue;
    }
    if (!sha512IntegrityPattern.test(integrity)) {
      findings.push(
        `${lockfilePath}:${lineNumber}: ${current.key} resolution.integrity must be a canonical sha512 digest`,
      );
      continue;
    }
    current.integrity = integrity;
  }
  if (inPackages) finishCurrent();
  if (!sawPackages) findings.push(`${lockfilePath}: missing top-level packages map`);

  return { findings, packages };
}

/** Parse the exact dependency edges in pnpm's `snapshots` map. */
export function parsePnpmSnapshotDependencies(
  lockfileText,
  { lockfilePath = 'pnpm-lock.yaml' } = {},
) {
  const findings = [];
  const snapshots = new Map();
  const lines = lockfileText.split(/\r?\n/u);
  let current;
  let dependencyBucket;
  let inSnapshots = false;
  let sawSnapshots = false;

  const finishCurrent = () => {
    if (!current) return;
    if (snapshots.has(current.key)) {
      findings.push(`${lockfilePath}:${current.line}: duplicate snapshots entry ${current.key}`);
    } else {
      snapshots.set(current.key, current.dependencies);
    }
    current = undefined;
    dependencyBucket = undefined;
  };

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (!inSnapshots) {
      if (line === 'snapshots:') {
        if (sawSnapshots) findings.push(`${lockfilePath}:${lineNumber}: duplicate snapshots map`);
        sawSnapshots = true;
        inSnapshots = true;
      }
      continue;
    }
    if (line !== '' && !line.startsWith(' ')) {
      finishCurrent();
      inSnapshots = false;
      continue;
    }
    if (line.startsWith(packageEntryIndent) && !line.startsWith(packageFieldIndent)) {
      finishCurrent();
      const parsed = parseMapEntry(line.slice(packageEntryIndent.length));
      if (!parsed || !['', '{}'].includes(parsed.value)) {
        findings.push(`${lockfilePath}:${lineNumber}: malformed snapshots entry`);
        continue;
      }
      current = { dependencies: new Map(), key: parsed.key, line: lineNumber };
      continue;
    }
    if (!current) continue;
    if (line.startsWith(packageFieldIndent) && !line.startsWith('      ')) {
      const parsed = parseMapEntry(line.slice(packageFieldIndent.length));
      dependencyBucket =
        parsed &&
        ['dependencies', 'optionalDependencies'].includes(parsed.key) &&
        parsed.value === ''
          ? parsed.key
          : undefined;
      continue;
    }
    if (!dependencyBucket || !line.startsWith('      ') || line.startsWith('        ')) continue;
    const parsed = parseMapEntry(line.slice(6));
    if (!parsed || parsed.value === '') {
      findings.push(
        `${lockfilePath}:${lineNumber}: ${current.key} ${dependencyBucket} entry must have a scalar version`,
      );
      continue;
    }
    if (current.dependencies.has(parsed.key)) {
      findings.push(
        `${lockfilePath}:${lineNumber}: ${current.key} repeats dependency ${parsed.key}`,
      );
      continue;
    }
    current.dependencies.set(parsed.key, parsed.value);
  }
  if (inSnapshots) finishCurrent();
  if (!sawSnapshots) findings.push(`${lockfilePath}: missing top-level snapshots map`);
  return { findings, snapshots };
}

export function packageSubjectFromSnapshotKey(snapshotKey) {
  const separator = snapshotKey.startsWith('@')
    ? snapshotKey.indexOf('@', snapshotKey.indexOf('/') + 1)
    : snapshotKey.indexOf('@');
  if (separator <= 0) return undefined;
  const dependency = snapshotKey.slice(0, separator);
  const versionWithPeers = snapshotKey.slice(separator + 1);
  const peerIndex = versionWithPeers.indexOf('(');
  const version = peerIndex === -1 ? versionWithPeers : versionWithPeers.slice(0, peerIndex);
  if (dependency === '' || version === '' || version.startsWith('link:')) return undefined;
  return { dependency, version };
}

export function snapshotKeysForSubject(snapshots, dependency, version) {
  const prefix = packageSnapshotKey(dependency, version);
  return [...snapshots.keys()].filter(
    (key) => key === prefix || (key.startsWith(prefix) && key[prefix.length] === '('),
  );
}

export function resolveSnapshotDependencyKeys(snapshots, dependency, versionWithPeers) {
  if (/^(?:link|file|workspace):/u.test(versionWithPeers)) return [];
  if (versionWithPeers.startsWith('npm:')) {
    const aliased = versionWithPeers.slice('npm:'.length);
    const subject = packageSubjectFromSnapshotKey(aliased);
    return subject ? snapshotKeysForSubject(snapshots, subject.dependency, subject.version) : [];
  }
  const exact = `${dependency}@${versionWithPeers}`;
  if (snapshots.has(exact)) return [exact];
  const peerIndex = versionWithPeers.indexOf('(');
  const version = peerIndex === -1 ? versionWithPeers : versionWithPeers.slice(0, peerIndex);
  return snapshotKeysForSubject(snapshots, dependency, version);
}

export function packageSnapshotKey(dependency, version) {
  return `${dependency}@${version}`;
}

export function lookupPnpmPackageIntegrity(packages, dependency, version) {
  return packages.get(packageSnapshotKey(dependency, version))?.integrity;
}

export function isCanonicalSha512Integrity(value) {
  return typeof value === 'string' && sha512IntegrityPattern.test(value);
}

function parsePackageEntryKey(line, lineNumber, lockfilePath, findings) {
  const source = line.slice(packageEntryIndent.length);
  if (!source.endsWith(':')) {
    findings.push(`${lockfilePath}:${lineNumber}: malformed packages entry`);
    return undefined;
  }
  const scalar = source.slice(0, -1);
  if (scalar.startsWith("'")) {
    if (!scalar.endsWith("'")) {
      findings.push(`${lockfilePath}:${lineNumber}: malformed single-quoted package key`);
      return undefined;
    }
    return scalar.slice(1, -1).replaceAll("''", "'");
  }
  if (scalar.startsWith('"')) {
    try {
      const value = JSON.parse(scalar);
      if (typeof value === 'string') return value;
    } catch {
      // Report the stable gate diagnostic below.
    }
    findings.push(`${lockfilePath}:${lineNumber}: malformed double-quoted package key`);
    return undefined;
  }
  if (scalar === '' || /[\s'"{}[\],]/u.test(scalar)) {
    findings.push(`${lockfilePath}:${lineNumber}: unsupported unquoted package key ${scalar}`);
    return undefined;
  }
  return scalar;
}

function parseFlowResolutionIntegrity(value) {
  if (!value.startsWith('{') || !value.endsWith('}')) return undefined;
  const fields = value
    .slice(1, -1)
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);
  let integrity;
  for (const field of fields) {
    const separator = field.indexOf(':');
    if (separator === -1) return undefined;
    const key = field.slice(0, separator).trim();
    const fieldValue = parsePlainScalar(field.slice(separator + 1).trim());
    if (key !== 'integrity') continue;
    if (integrity !== undefined || fieldValue === undefined) return undefined;
    integrity = fieldValue;
  }
  return integrity;
}

function parsePlainScalar(value) {
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'string' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return value === '' || /[\s{}[\],]/u.test(value) ? undefined : value;
}

function parseMapEntry(source) {
  let scalar;
  let rest;
  if (source.startsWith("'")) {
    let end = 1;
    while (end < source.length) {
      if (source[end] !== "'") {
        end += 1;
        continue;
      }
      if (source[end + 1] === "'") {
        end += 2;
        continue;
      }
      break;
    }
    if (source[end] !== "'" || source[end + 1] !== ':') return undefined;
    scalar = source.slice(1, end).replaceAll("''", "'");
    rest = source.slice(end + 2).trim();
  } else if (source.startsWith('"')) {
    let end = 1;
    for (; end < source.length; end += 1) {
      if (source[end] === '"' && source[end - 1] !== '\\') break;
    }
    if (source[end] !== '"' || source[end + 1] !== ':') return undefined;
    try {
      scalar = JSON.parse(source.slice(0, end + 1));
    } catch {
      return undefined;
    }
    rest = source.slice(end + 2).trim();
  } else {
    const separator = source.lastIndexOf(':');
    if (separator <= 0) return undefined;
    scalar = source.slice(0, separator).trim();
    rest = source.slice(separator + 1).trim();
  }
  const value = rest === '' || rest === '{}' ? rest : parsePlainScalar(rest);
  if (typeof scalar !== 'string' || scalar === '' || value === undefined) return undefined;
  return { key: scalar, value };
}
