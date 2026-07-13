import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { verifierApply, verifierStringStartsWith } from '../verifier-security-intrinsics.js';

/* eslint-disable typescript/unbound-method */
const nativePathIsAbsolute = path.isAbsolute;
const nativePathRelative = path.relative;
const nativePathResolve = path.resolve;
const nativePathSeparator = path.sep;

/** @internal Resolve one Playwright fixture directory without crossing its configured root. */
export async function resolveFixtureDirectory(
  fixturesRoot: string,
  fixtureName: string,
): Promise<string> {
  if (typeof fixturesRoot !== 'string' || typeof fixtureName !== 'string' || fixtureName === '') {
    throw new TypeError('Kovo fixture root and name must be non-empty strings.');
  }
  if (pathIsAbsolute(fixtureName)) {
    throw new TypeError('Kovo fixture name must be relative to the configured fixtures root.');
  }

  const lexicalRoot = pathResolve(fixturesRoot);
  const lexicalCandidate = pathResolve(lexicalRoot, fixtureName);
  if (!pathContainsStrict(lexicalRoot, lexicalCandidate)) {
    throw new TypeError('Kovo fixture name must stay beneath the configured fixtures root.');
  }

  const canonicalRoot = await realpath(lexicalRoot);
  const canonicalCandidate = await realpath(lexicalCandidate);
  if (!pathContainsStrict(canonicalRoot, canonicalCandidate)) {
    throw new TypeError('Kovo fixture directory must stay beneath the canonical fixtures root.');
  }
  const expectedCandidate = pathResolve(canonicalRoot, pathRelative(lexicalRoot, lexicalCandidate));
  if (canonicalCandidate !== expectedCandidate) {
    throw new TypeError('Kovo fixture directory must not traverse a symlinked path component.');
  }
  const info = await stat(canonicalCandidate);
  if (!info.isDirectory()) throw new TypeError('Kovo fixture path must resolve to a directory.');
  return canonicalCandidate;
}

function pathContainsStrict(root: string, candidate: string): boolean {
  const relative = pathRelative(root, candidate);
  return (
    relative !== '' &&
    relative !== '..' &&
    !pathIsAbsolute(relative) &&
    !verifierStringStartsWith(relative, `..${nativePathSeparator}`)
  );
}

function pathIsAbsolute(value: string): boolean {
  return verifierApply<boolean>(nativePathIsAbsolute, path, [value]);
}

function pathRelative(from: string, to: string): string {
  return verifierApply<string>(nativePathRelative, path, [from, to]);
}

function pathResolve(...values: string[]): string {
  return verifierApply<string>(nativePathResolve, path, values);
}
