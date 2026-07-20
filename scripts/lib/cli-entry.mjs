import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function isMainEntry(importMetaUrl, argv = process.argv, resolveRealpath = realpathSync) {
  const entryPath = argv[1];
  if (!entryPath) return false;
  const entryUrl = canonicalEntryUrl(entryPath, resolveRealpath);
  const moduleUrl = canonicalEntryUrl(fileURLToPath(importMetaUrl), resolveRealpath);
  return entryUrl === moduleUrl;
}

function canonicalEntryUrl(filePath, resolveRealpath) {
  const resolved = path.resolve(filePath);
  try {
    return pathToFileURL(resolveRealpath(resolved)).href;
  } catch (error) {
    if (error?.code !== 'ERR_ACCESS_DENIED') throw error;
    // Under a sealed Node permission model, both regular paths are already copied and canonical;
    // inability to inspect an ancestor must not make an imported gate execute as the main program.
    return pathToFileURL(resolved).href;
  }
}

export async function runGate(main) {
  try {
    const result = await main();
    if (typeof result === 'number') {
      process.exitCode = result;
    } else if (result === false) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${formatGateError(error)}\n`);
    process.exitCode = 1;
  }
}

function formatGateError(error) {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}
