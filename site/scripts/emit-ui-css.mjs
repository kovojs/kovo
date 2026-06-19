// Emit the docs site's generated @kovojs/ui stylesheet. The gallery renders
// @kovojs/ui components from static and compiled interactive fixtures, so the
// shared /assets/site.css must carry the matching StyleX atoms (SPEC §6.1.1,
// §13.1).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve workspace `.ts` sources behind `.js` specifiers while this script
// imports local packages from source in the monorepo.
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
const siteRoot = resolve(scriptDir, '..');
const outPath = resolve(siteRoot, 'src/generated/kovo-ui.css');

// The gallery's component atoms come from @kovojs/{headless-ui,ui}, resolved via
// the workspace symlinks under site/node_modules/@kovojs/*. When those are
// missing (a real broken install state) the imports/CLI fail with opaque module
// errors and a stale/short stylesheet would otherwise ship unstyled. Resolve
// the deps up front and fail loudly with the fix instead (SPEC §6.1.1, §13.1).
const missingDepHint = (dep, cause) =>
  new Error(
    `emit-ui-css: cannot resolve "${dep}". The gallery's component CSS (kv-button-/kv-switch-/` +
      `kv-dialog- atoms) comes from this package; without it the site ships an unstyled gallery. ` +
      `This usually means the workspace symlink site/node_modules/${dep} is missing. ` +
      `Run \`pnpm install\` (or \`corepack pnpm install\`) at the repo root to restore it.` +
      (cause ? `\nUnderlying error: ${cause}` : ''),
  );

let kovoUiTokenSheetCss;
try {
  ({ kovoUiTokenSheetCss } = await import('@kovojs/headless-ui'));
} catch (error) {
  throw missingDepHint('@kovojs/headless-ui', error?.message ?? error);
}
const { siteThemeCss } = await import('../src/theme.js');

// Representative component atoms that must appear in the extracted package CSS;
// their absence means the gallery would render with native fallbacks.
const REQUIRED_COMPONENT_ATOMS = ['kv-button-', 'kv-switch-', 'kv-dialog-'];

// Throw a clear, actionable error if the extracted @kovojs/ui component CSS is
// empty/short or missing the representative atoms, instead of silently shipping
// an unstyled gallery (SPEC §6.1.1, §13.1). Exported for resilience tests.
export function assertExtractedComponentCss(componentCss) {
  const missingAtoms = REQUIRED_COMPONENT_ATOMS.filter((atom) => !componentCss.includes(atom));
  if (missingAtoms.length > 0) {
    throw new Error(
      `emit-ui-css: extracted @kovojs/ui component CSS is empty or missing required atoms ` +
        `(${missingAtoms.join(', ')}); it would ship the gallery unstyled. ` +
        `Got ${componentCss.length} bytes from \`kovo compile package-css\`. ` +
        `Check that site/node_modules/@kovojs/{ui,headless-ui} are valid workspace symlinks ` +
        `(run \`pnpm install\` at the repo root).`,
    );
  }
}

export function emitSiteUiCss() {
  // The CLI extracts atoms from @kovojs/ui; surface a clear hint if the symlink
  // is missing before shelling out to `kovo compile package-css`.
  try {
    import.meta.resolve('@kovojs/ui');
  } catch (error) {
    throw missingDepHint('@kovojs/ui', error?.message ?? error);
  }

  const tempRoot = mkdtempSync(resolve(tmpdir(), 'kovo-site-ui-css-'));
  const componentCssPath = resolve(tempRoot, 'kovo-ui-components.css');

  try {
    let output;
    try {
      output = execFileSync(
        'kovo',
        [
          'compile',
          'package-css',
          '@kovojs/ui',
          '--entry',
          resolve(siteRoot, 'src/generated/app.routes.tsx'),
          '--out',
          componentCssPath,
        ],
        { cwd: siteRoot, encoding: 'utf8' },
      );
    } catch (error) {
      throw new Error(
        'emit-ui-css: `kovo compile package-css @kovojs/ui` failed; the gallery component CSS ' +
          '(kv-button-/kv-switch-/kv-dialog- atoms) could not be extracted. Ensure the workspace ' +
          'symlinks site/node_modules/@kovojs/{ui,cli} exist (run `pnpm install` at the repo root).' +
          `\nUnderlying error: ${error?.stderr || error?.message || error}`,
      );
    }
    const warnedFiles = [...output.matchAll(/^WARN package-css file=("[^"]+")/gm)].map((match) =>
      JSON.parse(match[1]),
    );
    for (const fileName of warnedFiles) {
      console.warn(`emit-ui-css: ${fileName}: package component CSS extraction warning`);
    }

    const componentCss = readFileSync(componentCssPath, 'utf8');
    // Guard against silently shipping an empty/short component sheet: the real
    // extraction is tens of KB and must carry the representative atoms. Without
    // this, a degraded extraction would ship the gallery unstyled with no
    // diagnostic (SPEC §6.1.1, §13.1).
    assertExtractedComponentCss(componentCss);

    const banner =
      '/* GENERATED by scripts/emit-ui-css.mjs - do not edit.\n' +
      '   @kovojs/ui design tokens + component StyleX CSS (SPEC §6.1.1, §13.1). */\n';
    const tokenCss = kovoUiTokenSheetCss.replace(/@theme[^{]*\{[\s\S]*?\n\}/, '').trimStart();
    const css = `${banner}\n${siteThemeCss}\n\n${tokenCss}\n${componentCss}\n`;

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, css);
    console.log(`emit-ui-css: wrote ${outPath}.`);
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  emitSiteUiCss();
}
