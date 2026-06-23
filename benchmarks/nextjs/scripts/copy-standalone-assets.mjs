import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const source = path.join(root, '.next/static');
const target = path.join(root, '.next/standalone/benchmarks/nextjs/.next/static');

await mkdir(path.dirname(target), { recursive: true });
await cp(source, target, { recursive: true });
