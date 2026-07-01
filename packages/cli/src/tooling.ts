import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** @internal Find the nearest named file walking up from `startDir`. */
export function findNearestFile(
  startDir: string,
  fileName: string,
  options: { stopDir?: string } = {},
): string | undefined {
  const absoluteStopDir = options.stopDir === undefined ? undefined : resolve(options.stopDir);
  for (let current = resolve(startDir); ; current = dirname(current)) {
    if (absoluteStopDir !== undefined) {
      const relativeToStop = relative(absoluteStopDir, current);
      if (relativeToStop.startsWith('..') || isAbsolute(relativeToStop)) return undefined;
    }

    const candidate = join(current, fileName);
    if (existsSync(candidate)) return candidate;
    if (current === absoluteStopDir) return undefined;

    const parent = dirname(current);
    if (parent === current) return undefined;
  }
}

export type ReadJsonRecordResult =
  | { ok: true; value: Record<string, unknown> }
  | {
      error: {
        kind: 'invalid-json' | 'invalid-shape' | 'not-found' | 'read-error';
        path: string;
      };
      ok: false;
    };

/** @internal Read a JSON file that must contain a non-array object. */
export function readJsonRecord(path: string): ReadJsonRecordResult {
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch (error) {
    return {
      error: {
        kind:
          isNodeErrorCode(error, 'ENOENT') || isNodeErrorCode(error, 'ENOTDIR')
            ? 'not-found'
            : 'read-error',
        path,
      },
      ok: false,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { error: { kind: 'invalid-json', path }, ok: false };
  }

  if (!isRecord(parsed)) return { error: { kind: 'invalid-shape', path }, ok: false };
  return { ok: true, value: parsed };
}

/** @internal Narrow unknown values to plain JSON-ish records. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
