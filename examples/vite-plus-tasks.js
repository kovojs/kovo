export function kovoExampleServeTask() {
  return {
    command: 'node scripts/serve.mjs',
    input: [
      { pattern: 'package.json', base: 'workspace' },
      { pattern: 'examples/vite-plus-tasks.js', base: 'workspace' },
      { pattern: 'scripts/*.mjs', base: 'workspace' },
      { pattern: 'src/**/*', base: 'workspace' },
      { pattern: 'vite.config.ts', base: 'workspace' },
    ],
  };
}
