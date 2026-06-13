export interface DiagnosticHelpFact {
  label: string;
  text: string;
}

export interface DiagnosticOutputFact {
  code: string;
  help: DiagnosticHelpFact[];
  location: string;
  message: string;
}

export interface ViteDiagnosticMessageFacts {
  diagnostics: DiagnosticOutputFact[];
  summary: string;
}

export function viteDiagnosticMessageFacts(message: string): ViteDiagnosticMessageFacts {
  const [summary = '', ...blocks] = message.trim().split(/\n\s*\n/);
  const diagnostics: DiagnosticOutputFact[] = [];

  for (const block of blocks) {
    const [header = '', ...lines] = block.split('\n');
    if (header.length === 0) continue;

    const match = /^([A-Z]{2}\d{3})\s+(\S+)\s+(.+)$/.exec(header);
    if (!match) {
      if (diagnostics.length > 0) break;
      throw new Error(`Vite diagnostic header is structured: ${header}`);
    }

    diagnostics.push({
      code: match[1] ?? '',
      help: diagnosticHelpFacts(lines),
      location: match[2] ?? '',
      message: match[3] ?? '',
    });
  }

  return { diagnostics, summary };
}

function diagnosticHelpFacts(lines: string[]): DiagnosticHelpFact[] {
  const help: DiagnosticHelpFact[] = [];

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    if (/^\s*help:/.test(line)) {
      help.push(diagnosticHelpFact(line));
      continue;
    }
    if (help.length > 0) break;

    throw new Error(`Vite diagnostic help line is structured: ${line}`);
  }

  return help;
}

function diagnosticHelpFact(line: string): DiagnosticHelpFact {
  const match = /^\s*help:\s+([^:]+):\s*(.*)$/.exec(line);
  if (match) {
    return { label: match[1] ?? '', text: match[2] ?? '' };
  }

  const fallbackMatch = /^\s*help:\s+(.+)$/.exec(line);
  if (fallbackMatch) {
    return { label: 'help', text: fallbackMatch[1] ?? '' };
  }

  throw new Error(`Vite diagnostic help line is structured: ${line}`);
}
