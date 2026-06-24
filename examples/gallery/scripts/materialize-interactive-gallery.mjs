import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { compileComponentModule } = await import(
  new URL('../../../packages/compiler/src/compile.ts', import.meta.url).href
);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const galleryRoot = resolve(scriptDir, '..');
const inputDir = resolve(galleryRoot, 'src/interactive');
const outputDir = resolve(galleryRoot, 'src/generated/interactive');

mkdirSync(outputDir, { recursive: true });

for (const demoName of interactiveDemoNames()) {
  const componentFileName = `src/interactive/${demoName}.tsx`;
  const result = compileComponentModule({
    fileName: componentFileName,
    source: readFileSync(resolve(galleryRoot, componentFileName), 'utf8'),
  });
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length > 0) {
    throw new Error(
      `Failed to compile ${componentFileName}:\n${errors
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join('\n')}`,
    );
  }

  const server = normalizeCompiledServerSource(
    result.loweredSource ?? result.files.find((artifact) => artifact.kind === 'server')?.source,
  );
  const client = result.files.find((artifact) => artifact.kind === 'client')?.source;
  if (server === undefined || client === undefined) {
    throw new Error(`${componentFileName} did not emit both server and client artifacts.`);
  }

  writeFileSync(resolve(outputDir, `${demoName}.tsx`), `${server.trimEnd()}\n`);
  writeFileSync(resolve(outputDir, `${demoName}.client.js`), `${client.trimEnd()}\n`);
}

function interactiveDemoNames() {
  return readdirSync(inputDir)
    .filter((fileName) => fileName.endsWith('-demo.tsx'))
    .map((fileName) => fileName.replace(/\.tsx$/, ''))
    .sort((left, right) => left.localeCompare(right));
}

function normalizeCompiledServerSource(source) {
  return source?.replace(/kovo-state="([^"]+)"/g, (_match, value) => {
    return `kovo-state='${value.replaceAll('&quot;', '"')}'`;
  });
}
