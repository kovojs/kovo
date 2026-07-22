import { performance } from 'node:perf_hooks';

import { compilerSourceSyntaxBudget } from '@kovojs/compiler/internal';
import { describe, expect, it } from 'vitest';

import { createKovoMcpServer } from './index.js';

const sourceByteLimit = 256 * 1024;

async function readyServer() {
  const server = createKovoMcpServer(process.cwd());
  await server.handleMessage({
    id: 'init',
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      capabilities: {},
      clientInfo: { name: 'resource-boundary-test', version: '1' },
      protocolVersion: '2025-06-18',
    },
  });
  await server.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return server;
}

async function compileThroughMcp(
  server: Awaited<ReturnType<typeof readyServer>>,
  source: string,
  fileName = 'benchmark.tsx',
): Promise<{ duration: number; response: Record<string, unknown> | undefined }> {
  const started = performance.now();
  const response = await server.handleMessage({
    id: 'compile',
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { arguments: { fileName, source }, name: 'compile_component' },
  });
  return { duration: performance.now() - started, response };
}

function padToByteBoundary(source: string): string {
  const remaining = sourceByteLimit - Buffer.byteLength(source, 'utf8');
  if (remaining < 5) throw new Error('source does not fit the byte-boundary comment');
  return `${source}\n/*${'x'.repeat(remaining - 5)}*/`;
}

function largestSyntaxAccepted(makeSource: (size: number) => string, high: number): string {
  let low = 1;
  let accepted = makeSource(1);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const source = makeSource(middle);
    const budget = compilerSourceSyntaxBudget('benchmark.tsx', source, {
      maxDepth: 256,
      maxNodes: 20_000,
    });
    if (Buffer.byteLength(source, 'utf8') <= sourceByteLimit && budget.ok) {
      accepted = source;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return accepted;
}

function toolResult(response: Record<string, unknown> | undefined): Record<string, unknown> {
  return (response as { result: Record<string, unknown> }).result;
}

describe('MCP compile resource envelope', () => {
  it('compiles byte-boundary flat/deep JSX and the alias-heavy AST boundary locally', async () => {
    const deepest = largestSyntaxAccepted(
      (depth) => `${'<div>'.repeat(depth)}x${'</div>'.repeat(depth)}`,
      256,
    );
    const shapes = {
      alias: largestSyntaxAccepted(
        (count) =>
          `const v0 = 0;\n${Array.from({ length: count }, (_, index) => `const v${index + 1} = v${index};`).join('\n')}\n<section />`,
        8_000,
      ),
      deep: padToByteBoundary(deepest),
      flat: padToByteBoundary(`<section>${'<i>x</i>'.repeat(255)}</section>`),
    };

    for (const [name, source] of Object.entries(shapes)) {
      const server = await readyServer();
      const measurement = await compileThroughMcp(server, source);
      const result = toolResult(measurement.response);
      expect(result.isError, `${name} resource boundary`).not.toBe(true);
      expect(result).toMatchObject({
        structuredContent: { version: 'compile/v1' },
      });
      // Measured locally as part of the regression: admitted worst shapes must stay bounded enough
      // for an interactive stdio tool, while allowing generous CI variance.
      expect(measurement.duration, `${name} compile duration`).toBeLessThan(10_000);
    }
  }, 30_000);

  it('rejects byte, pre-parse token, and raw nesting bombs while keeping the server usable', async () => {
    const server = await readyServer();
    const cases = [
      {
        message: 'compile_component source exceeds 262144 bytes',
        source: 'x'.repeat(sourceByteLimit + 1),
      },
      {
        message: 'compile_component source exceeds 32768 pre-parse tokens',
        source: ';'.repeat(sourceByteLimit),
      },
      {
        message: 'compile_component source exceeds 512 structural tokens',
        source: `${'('.repeat(Math.floor(sourceByteLimit / 2))}0${')'.repeat(
          Math.floor(sourceByteLimit / 2) - 1,
        )}`,
      },
    ];

    for (const testCase of cases) {
      const measurement = await compileThroughMcp(server, testCase.source);
      expect(measurement.duration).toBeLessThan(2_000);
      expect(toolResult(measurement.response)).toMatchObject({
        content: [{ text: testCase.message, type: 'text' }],
        isError: true,
      });
    }

    expect(toolResult((await compileThroughMcp(server, '<section />')).response)).toMatchObject({
      structuredContent: { ok: true, version: 'compile/v1' },
    });
  });

  it('rejects AST node/depth max plus one before lowering and remains usable', async () => {
    const aliasBoundary = largestSyntaxAccepted(
      (count) =>
        `const v0 = 0;\n${Array.from({ length: count }, (_, index) => `const v${index + 1} = v${index};`).join('\n')}\n<section />`,
      8_000,
    );
    const aliasOverBoundary = `${aliasBoundary}\nconst beyond = 1;`;
    expect(
      compilerSourceSyntaxBudget('benchmark.tsx', aliasOverBoundary, {
        maxDepth: 256,
        maxNodes: 20_000,
      }),
    ).toMatchObject({ ok: false, reason: 'nodes' });

    const depthBoundary = largestSyntaxAccepted(
      (depth) => `${'<div>'.repeat(depth)}x${'</div>'.repeat(depth)}`,
      256,
    );
    const depth = depthBoundary.match(/<div>/gu)?.length ?? 0;
    const depthOverBoundary = `${'<div>'.repeat(depth + 1)}x${'</div>'.repeat(depth + 1)}`;
    expect(
      compilerSourceSyntaxBudget('benchmark.tsx', depthOverBoundary, {
        maxDepth: 256,
        maxNodes: 20_000,
      }),
    ).toMatchObject({ ok: false, reason: 'depth' });

    const server = await readyServer();
    expect(toolResult((await compileThroughMcp(server, aliasOverBoundary)).response)).toMatchObject(
      {
        content: [{ text: 'compile_component source exceeds 20000 syntax nodes', type: 'text' }],
        isError: true,
      },
    );
    expect(toolResult((await compileThroughMcp(server, depthOverBoundary)).response)).toMatchObject(
      {
        content: [{ text: 'compile_component source exceeds 256 syntax depth', type: 'text' }],
        isError: true,
      },
    );
    expect(toolResult((await compileThroughMcp(server, '<section />')).response)).toMatchObject({
      structuredContent: { ok: true, version: 'compile/v1' },
    });
  });

  it('normalizes recursive parser exhaustion and keeps the finite session usable', async () => {
    const server = await readyServer();
    const measurement = await compileThroughMcp(server, `${'x=>'.repeat(9_000)}0`);
    expect(measurement.duration).toBeLessThan(2_000);
    expect(toolResult(measurement.response)).toMatchObject({
      content: [
        {
          text: 'compile_component source exceeds the finite parser recursion budget',
          type: 'text',
        },
      ],
      isError: true,
    });
    expect(toolResult((await compileThroughMcp(server, '<section />')).response)).toMatchObject({
      structuredContent: { ok: true, version: 'compile/v1' },
    });
  });

  it('bounds descending unique package discovery and the ambient directory walk', async () => {
    const packageImports = (count: number) =>
      `${Array.from(
        { length: count },
        (_, index) => `import '@mcp/package-${String(count - index).padStart(3, '0')}';`,
      ).join('\n')}\n<section />`;
    const deepestAdmittedFileName = `${Array.from(
      { length: 63 },
      (_, index) => `segment-${index}`,
    ).join('/')}/component.tsx`;
    const server = await readyServer();

    const admitted = await compileThroughMcp(server, packageImports(128), deepestAdmittedFileName);
    expect(admitted.duration).toBeLessThan(10_000);
    expect(toolResult(admitted.response)).toMatchObject({
      structuredContent: { version: 'compile/v1' },
    });

    const overPackages = await compileThroughMcp(server, packageImports(129));
    expect(overPackages.duration).toBeLessThan(2_000);
    expect(toolResult(overPackages.response)).toMatchObject({
      content: [
        { text: 'Compiler bounded package discovery exceeds 128 unique packages.', type: 'text' },
      ],
      isError: true,
    });

    const overPath = await compileThroughMcp(
      server,
      '<section />',
      `${Array.from({ length: 64 }, () => 'segment').join('/')}/component.tsx`,
    );
    expect(toolResult(overPath.response)).toMatchObject({
      content: [{ text: 'compile_component fileName exceeds 64 path segments', type: 'text' }],
      isError: true,
    });
  }, 15_000);
});
