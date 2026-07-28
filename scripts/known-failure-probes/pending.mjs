#!/usr/bin/env node
const id = process.argv[2] ?? '<unknown>';
process.stderr.write(`${id}: packed expected-failure probe is not implemented yet\n`);
process.exitCode = 2;
