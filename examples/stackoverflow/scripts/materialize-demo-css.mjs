import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve workspace TS sources behind local `.js` specifiers when this script
// imports the example theme from source, matching the demo serve path.
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
const soRoot = resolve(scriptDir, '..');
const appEntry = resolve(soRoot, 'src/app-shell.ts');
const stylesPath = resolve(soRoot, 'dist/assets/styles.css');
const manifestPath = resolve(soRoot, 'dist/stackoverflow-css-manifest.json');
const { extractAppComponentCss } = await import('@kovojs/compiler/package-styles');
const { soTheme } = await import('../src/theme.ts');

const appCss = extractAppComponentCss({
  fileName: appEntry,
  packagePrefixDiscoveryRoot: soRoot,
  source: readFileSync(appEntry, 'utf8'),
});

if (appCss.diagnostics.length > 0) {
  const details = appCss.diagnostics
    .map((diagnostic) => `${diagnostic.fileName}: ${diagnostic.message}`)
    .join('\n');
  throw new Error(`Stack Overflow demo CSS extraction failed:\n${details}`);
}

const baseCss = readFileSync(stylesPath, 'utf8').trim();
const chunks = [baseCss, soTheme.css, appCss.css].filter(Boolean).map((chunk) => chunk.trim());
const css = `${[...new Set(chunks)].join('\n')}\n`;
const hash = createHash('sha256').update(css).digest('hex').slice(0, 12);
const hashedHref = `/assets/styles.${hash}.css`;
const hashedStylesPath = resolve(soRoot, `dist${hashedHref}`);

writeFileSync(stylesPath, css);
writeFileSync(hashedStylesPath, css);
writeFileSync(
  manifestPath,
  `${JSON.stringify({ href: hashedHref, version: 1 }, null, 2)}\n`,
  'utf8',
);

console.log(
  `materialize-demo-css: wrote ${hashedStylesPath} (${appCss.sourceFiles.length} source files scanned).`,
);
