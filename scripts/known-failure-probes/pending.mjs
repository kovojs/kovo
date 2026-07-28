#!/usr/bin/env node
const idArgument = process.argv.indexOf('--id');
const manifestArgument = process.argv.indexOf('--packed-manifest');
const id = process.argv[idArgument + 1];
const packedManifest = process.argv[manifestArgument + 1];
if (
  idArgument === -1 ||
  manifestArgument === -1 ||
  !/^KF-DEVEX-\d{3}$/u.test(id ?? '') ||
  !packedManifest
) {
  process.stderr.write('Usage: node pending.mjs --id <KF-DEVEX-NNN> --packed-manifest <path>\n');
  process.exit(2);
}
process.stderr.write(`${id}: packed expected-failure probe is not implemented yet\n`);
process.exitCode = 2;
