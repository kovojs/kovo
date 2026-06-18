import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { createServer } from 'vite';

execFileSync('vp', ['build'], { stdio: 'inherit' });

const viteServer = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const { runKovoCommand } = await viteServer.ssrLoadModule('@kovojs/cli');
  const result = await captureKovoCommandOutput(() =>
    runKovoCommand([
      'export',
      '/src/app-shell.ts',
      '--vite',
      '--out',
      'dist',
      '--manifest',
      join('dist', '.vite', 'manifest.json'),
      '--dist',
      'dist',
      '--stylesheet-env',
      'KOVO_STARTER_STYLESHEET_HREF',
    ]),
  );

  if (result.exitCode === 0) {
    process.stdout.write(result.stdout.replace(/^kovo-export\/v1/m, 'starter-export/v1'));
  } else {
    process.stderr.write(result.stderr.replace(/^kovo-export\/v1/m, 'starter-export/v1'));
    process.exitCode = result.exitCode;
  }
} finally {
  await viteServer.close();
}

async function captureKovoCommandOutput(run) {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;

  try {
    process.stdout.write = (chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    };
    process.stderr.write = (chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    };

    return {
      exitCode: await run(),
      stderr: stderrChunks.join(''),
      stdout: stdoutChunks.join(''),
    };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}
