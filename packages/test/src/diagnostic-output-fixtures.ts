import { generatedHandlerReferenceFact } from './generated-module-fixtures.ts';
import { htmlElementFacts } from './html-fragment.ts';

import type { GeneratedHandlerReferenceFact } from './generated-module-fixtures.ts';

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

export interface ViteLoweredEventDiagnosticFact {
  diagnostic: Pick<DiagnosticOutputFact, 'code' | 'location' | 'message'>;
  elementParams: string;
  help: DiagnosticHelpFact[];
  loweredHandler: Pick<
    GeneratedHandlerReferenceFact,
    'handlerName' | 'modulePath' | 'versionShape'
  >;
  sourceExpression: string;
  summary: string;
}

const viteDiagnosticSummaryPrefix = 'Kovo Vite transform failed';

export function viteDiagnosticMessageFactsFromOutput(output: string): ViteDiagnosticMessageFacts {
  const diagnosticStart = output.indexOf(viteDiagnosticSummaryPrefix);
  if (diagnosticStart === -1) {
    throw new Error('Vite diagnostic output includes Kovo transform summary');
  }

  return viteDiagnosticMessageFacts(output.slice(diagnosticStart).trim());
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

export function viteLoweredEventDiagnosticFact(output: string): ViteLoweredEventDiagnosticFact {
  const { diagnostics, summary } = viteDiagnosticMessageFactsFromOutput(output);
  const diagnostic = diagnostics[0];
  if (!diagnostic) {
    throw new Error('Vite diagnostic output includes a diagnostic');
  }

  const loweredHelp = diagnostic.help.find((entry) => entry.label === 'Would lower to');
  if (!loweredHelp) {
    throw new Error('Vite diagnostic output includes lowered handler help');
  }

  const loweredAttrs = htmlElementFacts(`<button ${loweredHelp.text}></button>`, {
    tag: 'button',
  })[0]?.attrs;
  const loweredHandler = generatedHandlerReferenceFact(loweredAttrs?.['on:click'] ?? '');
  const sourceExpression =
    diagnostic.help.find((entry) => entry.label === 'Blocked expression')?.text ?? '';
  const elementParams =
    diagnostic.help.find((entry) => entry.label === 'Element params')?.text ?? '';

  return {
    diagnostic: {
      code: diagnostic.code,
      location: diagnostic.location,
      message: diagnostic.message,
    },
    elementParams,
    help: diagnostic.help,
    loweredHandler: {
      handlerName: loweredHandler.handlerName,
      modulePath: loweredHandler.modulePath,
      versionShape: loweredHandler.versionShape,
    },
    sourceExpression,
    summary,
  };
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
