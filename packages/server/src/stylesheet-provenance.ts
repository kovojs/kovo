import {
  securityRegExpExec,
  securityRegExpTest,
  securityStringIncludes,
  securityStringSplit,
} from './response-security-intrinsics.js';

/**
 * Returns the first app-authored file in a stylesheet helper stack.
 *
 * Published builds bundle the helper into a content-hashed `document-core` chunk,
 * so the boundary cannot depend only on the source filename remaining `hints.ts`.
 * Named helper frames are skipped independently of the emitted chunk name.
 */
export function stylesheetCallerFile(stack: string | undefined): string | undefined {
  if (stack === undefined) return undefined;

  const lines = securityStringSplit(stack, '\n');
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (isStylesheetHelperFrame(line)) continue;

    const fileUrl = securityRegExpExec(/file:\/\/[^):\s]+/u, line)?.[0];
    if (fileUrl !== undefined) return fileUrl;

    const pathMatch = securityRegExpExec(/(?:(?:at\s+.*\()?)(\/[^():]+):\d+:\d+\)?/u, line)?.[1];
    if (pathMatch !== undefined) return `file://${pathMatch}`;
  }
  return undefined;
}

function isStylesheetHelperFrame(line: string): boolean {
  if (securityStringIncludes(line, '/hints.') || securityStringIncludes(line, '\\hints.')) {
    return true;
  }

  return securityRegExpTest(
    /\bat\s+(?:[A-Za-z_$][\w$]*\.)?(?:stylesheetCallerFile|localStylesheetSourceFile|stylesheet)\s+\(/u,
    line,
  );
}
