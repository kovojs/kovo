import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';
import type { StaticExportHtmlPathStyle } from './static-export-types.js';

export function normalizeStaticExportHtmlPathStyle(
  style: StaticExportHtmlPathStyle | undefined,
): StaticExportHtmlPathStyle {
  // SPEC §9.5: exported route documents default to directory-index HTML.
  if (style === undefined) return 'directory';
  if (style === 'flat' || style === 'directory') return style;

  throw new StaticExportError([
    staticExportDiagnostic(
      'htmlPathStyle',
      `FW229 static export refused htmlPathStyle '${String(
        style,
      )}'. Expected 'flat' or 'directory'.`,
    ),
  ]);
}
