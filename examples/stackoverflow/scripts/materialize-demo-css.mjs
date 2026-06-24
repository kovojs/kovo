import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

const scriptDir = dirname(fileURLToPath(import.meta.url));
const exampleRoot = resolve(scriptDir, '..');
const appEntry = resolve(exampleRoot, 'src/interactive-app.tsx');
const stylesheetPath = resolve(exampleRoot, 'dist/assets/styles.css');

const { extractAppComponentCss } = await import('@kovojs/compiler');
const result = extractAppComponentCss({
  fileName: appEntry,
  packagePrefixDiscoveryRoot: resolve(exampleRoot, 'src'),
  source: existsSync(appEntry) ? readFileSync(appEntry, 'utf8') : '',
});

if (result.diagnostics.length > 0) {
  throw new Error(
    [
      'stackoverflow demo CSS extraction failed:',
      ...result.diagnostics.map((diagnostic) => `- ${diagnostic.fileName}: ${diagnostic.message}`),
    ].join('\n'),
  );
}

if (!result.css) {
  throw new Error('stackoverflow demo CSS extraction produced no component CSS.');
}

if (!existsSync(stylesheetPath)) {
  throw new Error(`stackoverflow demo CSS target missing: ${stylesheetPath}. Run vp build first.`);
}

const currentCss = readFileSync(stylesheetPath, 'utf8');
writeFileSync(
  stylesheetPath,
  `${currentCss.trimEnd()}\n\n/* GENERATED app component CSS - do not edit. */\n${result.css.trim()}\n`,
);
