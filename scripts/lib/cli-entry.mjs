import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function isMainEntry(importMetaUrl, argv = process.argv) {
  const entryPath = argv[1];
  if (!entryPath) return false;
  const entryUrl = pathToFileURL(realpathSync(path.resolve(entryPath))).href;
  const moduleUrl = pathToFileURL(realpathSync(fileURLToPath(importMetaUrl))).href;
  return entryUrl === moduleUrl;
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
