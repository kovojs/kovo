export interface McpJsonRpcResponseFact {
  id: number | string | null;
  result: unknown;
}

export interface McpCompileDiagnosticFact {
  code: string;
  severity: string;
}

export interface McpCompileResponseFact {
  contentVersion: 'compile/v1';
  diagnostics: McpCompileDiagnosticFact[];
  id: number | string | null;
  ok: boolean;
  version: 'fw-mcp/v1';
}

export function mcpJsonRpcResponseFacts(
  output: string | readonly string[],
): McpJsonRpcResponseFact[] {
  const source = typeof output === 'string' ? output : output.join('');
  const lines = source
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.length > 0);

  return lines.map((line) => {
    const parsed = JSON.parse(line) as unknown;
    if (!isRecord(parsed)) {
      throw new Error(`MCP stdio response line is a JSON object: ${line}`);
    }
    if (!('result' in parsed)) {
      throw new Error(`MCP stdio response line includes a result: ${line}`);
    }

    const id = parsed.id;
    if (typeof id !== 'string' && typeof id !== 'number' && id !== null) {
      throw new Error(`MCP stdio response id is string, number, or null: ${line}`);
    }

    return { id, result: parsed.result };
  });
}

export function mcpCompileResponseFacts(
  output: string | readonly string[],
): McpCompileResponseFact[] {
  return mcpJsonRpcResponseFacts(output).map((response) => {
    const result = response.result;
    if (!isRecord(result)) {
      throw new Error(`MCP compile response result is an object for id ${String(response.id)}`);
    }
    if (result.version !== 'fw-mcp/v1') {
      throw new Error(`MCP compile response uses fw-mcp/v1 for id ${String(response.id)}`);
    }

    const structuredContent = result.structuredContent;
    if (!isRecord(structuredContent)) {
      throw new Error(`MCP compile response has structured content for id ${String(response.id)}`);
    }
    if (structuredContent.version !== 'compile/v1') {
      throw new Error(`MCP compile response uses compile/v1 for id ${String(response.id)}`);
    }
    if (typeof structuredContent.ok !== 'boolean') {
      throw new Error(`MCP compile response ok is boolean for id ${String(response.id)}`);
    }

    return {
      contentVersion: structuredContent.version,
      diagnostics: compileDiagnosticFacts(structuredContent.diagnostics, response.id),
      id: response.id,
      ok: structuredContent.ok,
      version: result.version,
    };
  });
}

function compileDiagnosticFacts(
  diagnostics: unknown,
  id: number | string | null,
): McpCompileDiagnosticFact[] {
  if (!Array.isArray(diagnostics)) {
    throw new Error(`MCP compile response diagnostics is an array for id ${String(id)}`);
  }

  return diagnostics.map((diagnostic) => {
    if (!isRecord(diagnostic)) {
      throw new Error(`MCP compile diagnostic is an object for id ${String(id)}`);
    }
    if (typeof diagnostic.code !== 'string' || typeof diagnostic.severity !== 'string') {
      throw new Error(`MCP compile diagnostic exposes code and severity for id ${String(id)}`);
    }

    return {
      code: diagnostic.code,
      severity: diagnostic.severity,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
