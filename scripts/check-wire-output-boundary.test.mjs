import { describe, expect, it } from 'vitest';

import {
  checkWireOutputBoundary,
  wireBodyProvenanceFile,
  wireBodyProvenanceOracleFile,
  wireBodyProvenanceRelationFile,
} from './check-wire-output-boundary.mjs';

const baseFiles = {
  [wireBodyProvenanceFile]: `
setServerAliasPattern(node.variableDeclaration.name, 'unsafe-wire-data', aliases);
setServerAliasPattern(parameterSnapshot[0]!.name, 'unsafe-wire-data', aliases);
appendUnsafeWireBodyViolation(
            node.arguments?.[0],
            'new Response', aliases, appendViolation);
appendUnsafeWireBodyViolation(call.arguments[0], target, aliases, appendViolation);
`,
  [wireBodyProvenanceRelationFile]: `'unsafe-wire-data': { default: 'unsafe-wire-data' },`,
  [wireBodyProvenanceOracleFile]: `
// @kovo-security-classifier-corpus finite-security-operation-ir
// a catch-bound Error.message
// the raw request URL
// a request-derived JSON field
`,
  'packages/server/src/response-posture.ts': `export function emitToWire(value) { return new Response(value.body); }`,
  'packages/server/src/response.ts': `import { emitToWire } from './response-posture.js';
export function ok(value) { return emitToWire(value, 'framework-response', { method: 'GET' }); }`,
};

function run(files) {
  const all = { ...baseFiles, ...files };
  return checkWireOutputBoundary({
    repoRoot: '/repo',
    sourceFiles: Object.keys(all),
    readText: (file) => all[file] ?? '',
    exists: (file) => Object.hasOwn(all, file),
  });
}

describe('check-wire-output-boundary', () => {
  it('passes when framework responses use emitToWire', () => {
    expect(run({}).ok).toBe(true);
  });

  it('passes when the response choke is a branded wireEmitter export', () => {
    expect(
      run({
        'packages/server/src/response-posture.ts': `
import { wireEmitter } from '@kovojs/core/internal/security-markers';
export const emitToWire = wireEmitter('server.response.emit-to-wire', function (value) {
  return new Response(value.body);
});
`,
      }).ok,
    ).toBe(true);
  });

  it('rejects a planted direct Response canary outside the choke', () => {
    const result = run({
      'packages/server/src/canary.ts': `export function leak() { return new Response('secret'); }`,
    });

    expect(result.ok).toBe(false);
    expect(result.findings.join('\n')).toContain('packages/server/src/canary.ts:1');
    expect(result.findings.join('\n')).toContain('new Response must route through emitToWire()');
  });

  it('rejects Response.json outside the choke', () => {
    const result = run({
      'packages/server/src/json-canary.ts': `export const leak = () => Response.json({ ok: true });`,
    });

    expect(result.ok).toBe(false);
    expect(result.findings.join('\n')).toContain('Response.json must route through emitToWire()');
  });

  it('rejects node header writes outside adapter bridges', () => {
    const result = run({
      'packages/server/src/raw-header.ts': `export function leak(res) { res.writeHead(200); res.setHeader('x', 'y'); }`,
    });

    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(2);
  });

  it('ignores comments, strings, and explicit adapter files', () => {
    const result = run({
      'packages/server/src/stringy.ts': `// new Response('nope')
const example = "Response.json({})";`,
      'packages/server/src/node.ts': `export function adapter(res) { res.writeHead(200); }`,
      'packages/server/src/vite-dev.ts': `export function dev() { return new Response('hmr'); }`,
    });

    expect(result.ok).toBe(true);
  });

  it('fails when emitToWire is missing from the choke file', () => {
    const result = run({
      'packages/server/src/response-posture.ts': `export function notTheChoke() { return new Response('x'); }`,
    });

    expect(result.ok).toBe(false);
    expect(result.findings.join('\n')).toContain('exported emitToWire() choke is missing');
  });

  it('fails when the Layer-3 body provenance sink or hostile oracle is deleted', () => {
    const missingSink = run({
      [wireBodyProvenanceFile]: baseFiles[wireBodyProvenanceFile].replace(
        'appendUnsafeWireBodyViolation(call.arguments[0], target, aliases, appendViolation);',
        '',
      ),
    });
    expect(missingSink.ok).toBe(false);
    expect(missingSink.findings.join('\n')).toContain('Layer-3 response-body provenance anchor');

    const missingOracle = run({
      [wireBodyProvenanceOracleFile]: baseFiles[wireBodyProvenanceOracleFile].replace(
        'a catch-bound Error.message',
        '',
      ),
    });
    expect(missingOracle.ok).toBe(false);
    expect(missingOracle.findings.join('\n')).toContain('hostile response-body oracle anchor');
  });
});
