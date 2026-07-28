import { readFileSync } from 'node:fs';

import {
  KOVO_COMMAND_SCHEMA,
  type KovoCommandEntry,
  type KovoCommandName,
  type KovoCommandOptionSchema,
  type KovoCommandSchemaEntry,
  type KovoCommandUsageForm,
  type KovoCommandUsageToken,
} from './command-schema.js';

export type {
  KovoAsyncCommandName,
  KovoCommandEntry,
  KovoCommandName,
  KovoSyncCommandName,
} from './command-schema.js';

/**
 * @internal
 *
 * Adapters over the semantic command AST in `command-schema.ts`. Argv, help,
 * completion, and command-reference output all resolve through this module so a
 * new flag or command cannot exist on only one surface.
 */

/** @internal Version of the installed CLI package. */
export const KOVO_CLI_VERSION = readCliVersion();

/** @internal Usage line emitted for `kovo check`. */
export const CHECK_USAGE = renderInlineUsage(requireCommand('check'));

/** @internal Usage line emitted for asynchronous advisory verification. */
export const ADVISORY_USAGE = renderFormUsageLine(
  requireCommand('check'),
  requireUsageForm('check', 'advisories'),
  'usage: ',
);

/** @internal Usage line emitted for `kovo audit`. */
export const AUDIT_USAGE = renderInlineUsage(requireCommand('audit'));

/** @internal Usage forms emitted for `kovo explain`. */
export const EXPLAIN_USAGE = renderMultilineUsage(requireCommand('explain'));

/** @internal Single-line explain usage emitted on error paths. */
export const EXPLAIN_USAGE_LINE = renderJoinedUsage(requireCommand('explain'));

/** @internal Usage line emitted for `kovo add`. */
export const ADD_USAGE = renderInlineUsage(requireCommand('add'));

/** @internal Usage line emitted for `kovo build`. */
export const BUILD_USAGE = renderInlineUsage(requireCommand('build'));

/** @internal Usage line emitted for `kovo dev`. */
export const DEV_USAGE = renderInlineUsage(requireCommand('dev'));

/** @internal Usage line emitted for `kovo db`. */
export const DB_USAGE = renderInlineUsage(requireCommand('db'));

/** @internal Usage forms emitted for `kovo compile`. */
export const COMPILE_USAGE = renderMultilineUsage(requireCommand('compile'));

/** @internal Single-line compile usage emitted on error paths. */
export const COMPILE_USAGE_LINE = renderJoinedUsage(requireCommand('compile'));

/** @internal Usage line emitted for `kovo fix`. */
export const FIX_USAGE = renderInlineUsage(requireCommand('fix'));

/** @internal Usage line emitted for `kovo export`. */
export const EXPORT_USAGE = renderInlineUsage(requireCommand('export'));

/** @internal Usage line emitted for `kovo mcp`. */
export const MCP_USAGE = renderInlineUsage(requireCommand('mcp'));

/** @internal Usage line emitted for `kovo update-docs`. */
export const UPDATE_DOCS_USAGE = renderInlineUsage(requireCommand('update-docs'));

/** @internal Usage line emitted for `kovo incident`. */
export const INCIDENT_USAGE = renderInlineUsage(requireCommand('incident'));

/** @internal One flag rendered into the generated command reference. */
export interface CommandFlag {
  readonly description: string;
  readonly flag: string;
}

/** @internal Coarse argv carrier kind used after semantic schema projection. */
export type CommandArgvOptionKind = 'boolean' | 'value';

/** @internal One option projected from a semantic command node for argv parsing. */
export interface CommandArgvOptionSpec {
  readonly aliases: readonly string[];
  readonly category?: KovoCommandOptionSchema['category'];
  readonly defaultValue?: string;
  readonly enumValues?: readonly string[];
  readonly flag: `--${string}`;
  readonly id: string;
  readonly kind: CommandArgvOptionKind;
  readonly repeat?: boolean;
  readonly requiresValueMessage?: string;
  readonly valueKind?: Exclude<KovoCommandOptionSchema['value'], undefined>['kind'];
}

/** @internal One command or command-form argv parser schema. */
export interface CommandArgvSpec {
  readonly command: KovoCommandName;
  readonly options: readonly CommandArgvOptionSpec[];
  readonly usageForm?: string;
}

/** @internal Parsed argv result before command-specific semantic validation. */
export interface ParsedCommandArgv {
  readonly options: ReadonlyMap<string, true | string | readonly string[]>;
  readonly positionals: readonly string[];
}

/** @internal Shared argv parser result. */
export type ParseCommandArgvResult =
  | { readonly ok: true; readonly value: ParsedCommandArgv }
  | { readonly error: 'help'; readonly ok: false }
  | { readonly error: 'missing-value'; readonly message: string; readonly ok: false }
  | { readonly error: 'unknown-option'; readonly ok: false; readonly option: string };

/** @internal Check graph-mode flags. */
export const CHECK_ARGV_SPEC = argvSpec('check', []);

/** @internal Advisory-check flags. */
export const ADVISORY_ARGV_SPEC = argvSpecForUsage('check', 'advisories');

/** @internal Audit flags. */
export const AUDIT_ARGV_SPEC = argvSpec('audit');

/** @internal Explain flags. */
export const EXPLAIN_ARGV_SPEC = argvSpec('explain');

/** @internal Incident flags. */
export const INCIDENT_ARGV_SPEC = argvSpec('incident');

/** @internal Add flags. */
export const ADD_ARGV_SPEC = argvSpec('add');

/** @internal Build flags. */
export const BUILD_ARGV_SPEC = argvSpec('build');

/** @internal Fix flags. */
export const FIX_ARGV_SPEC = argvSpec('fix');

/** @internal Dev flags. */
export const DEV_ARGV_SPEC = argvSpec('dev');

/** @internal DB flags. */
export const DB_ARGV_SPEC = argvSpec('db');

/** @internal Export flags. */
export const EXPORT_ARGV_SPEC = argvSpec('export');

/** @internal Compile-form flags, each derived from the referenced option ids. */
export const COMPILE_ARGV_SPECS = Object.freeze({
  component: argvSpecForUsage('compile', 'component'),
  'drizzle-optimistic': argvSpecForUsage('compile', 'drizzle-optimistic'),
  'drizzle-static': argvSpecForUsage('compile', 'drizzle-static'),
  graph: argvSpecForUsage('compile', 'graph'),
  'mutation-inputs': argvSpecForUsage('compile', 'mutation-inputs'),
  'package-css': argvSpecForUsage('compile', 'package-css'),
  route: argvSpecForUsage('compile', 'route'),
});

/** @internal One command-reference projection. */
export interface CommandManifestEntry {
  readonly aliases: readonly string[];
  readonly async?: boolean;
  readonly category: KovoCommandSchemaEntry['category'];
  readonly examples: readonly string[];
  readonly exits: KovoCommandSchemaEntry['exits'];
  readonly flags: readonly CommandFlag[];
  readonly name: KovoCommandName;
  readonly noArgsOrder: number;
  readonly resultProtocol: string | null;
  readonly summary: string;
  readonly unknownOrder: number;
  readonly usage: string | readonly string[];
}

/**
 * @internal Complete generated command-reference data. This is an adapter, not
 * an independently editable manifest.
 */
export const COMMANDS_MANIFEST: readonly CommandManifestEntry[] = Object.freeze(
  KOVO_COMMAND_SCHEMA.map((entry) =>
    Object.freeze({
      aliases: entry.aliases,
      ...('async' in entry && entry.async ? { async: true } : {}),
      category: entry.category,
      examples: entry.examples,
      exits: entry.exits,
      flags: referenceFlags(entry),
      name: entry.name,
      noArgsOrder: entry.order,
      resultProtocol: entry.resultProtocol,
      summary: entry.summary,
      unknownOrder: entry.order,
      usage:
        entry.referenceUsage === 'multiline'
          ? renderMultilineUsage(entry)
          : renderInlineUsage(entry),
    }),
  ),
);

const COMMAND_REGISTRY = new Map<KovoCommandName, KovoCommandEntry>(
  KOVO_COMMAND_SCHEMA.map((entry) => [entry.name, entry]),
);
const COMMAND_ALIAS_REGISTRY = new Map<string, KovoCommandEntry>(
  KOVO_COMMAND_SCHEMA.flatMap((entry) => entry.aliases.map((alias) => [alias, entry] as const)),
);

/** @internal Resolve a canonical command name or declared alias. */
export function resolveCommand(name: string | undefined): KovoCommandEntry | undefined {
  if (name === undefined) return undefined;
  return COMMAND_REGISTRY.get(name as KovoCommandName) ?? COMMAND_ALIAS_REGISTRY.get(name);
}

/** @internal True when a command routes through `mainAsync`. */
export function isAsyncCommand(
  entry: KovoCommandEntry,
): entry is Extract<KovoCommandEntry, { async: true }> {
  return 'async' in entry && entry.async === true;
}

/** @internal Command list retained for compact docs snippets. */
export function formatNoArgsCommandList(): string {
  return orderedCommands()
    .map((entry) => entry.name)
    .join(', ');
}

/** @internal Compact command-list message retained as generated reference data. */
export function formatNoArgsMessage(): string {
  return `kovo: ${formatNoArgsCommandList()}\n`;
}

/** @internal Complete expected-command phrase for diagnostics. */
export function formatExpectedCommandList(): string {
  return sentenceList(orderedCommands().map((entry) => entry.name));
}

/** @internal Unknown-command diagnostic text. */
export function formatUnknownCommandMessage(command: string): string {
  return `kovo: unknown command ${JSON.stringify(command)}. expected ${formatExpectedCommandList()}.\n`;
}

/** @internal Generated root help. */
export function formatRootHelp(): string {
  const lines = [
    `Kovo ${KOVO_CLI_VERSION}`,
    '',
    'Usage:',
    '  kovo <command> [options]',
    '  kovo help [command]',
    '  kovo completion <bash|zsh|fish>',
    '  kovo --version',
    '',
  ];
  for (const category of [
    ['daily-build', 'Daily and build'],
    ['inspect-security', 'Inspect and security'],
    ['agent-operator', 'Agent and operator'],
  ] as const) {
    lines.push(`${category[1]}:`);
    for (const entry of orderedCommands().filter(
      (candidate) => candidate.category === category[0],
    )) {
      lines.push(`  ${entry.name.padEnd(13)} ${entry.summary}`);
    }
    lines.push('');
  }
  lines.push(
    'Global options:',
    '  -h, --help     Show generated help.',
    '  -V, --version  Show the installed CLI version.',
    '',
    'Run `kovo help <command>` for command details.',
    '',
  );
  return lines.join('\n');
}

/** @internal Generated multiline help for one capability command. */
export function formatCommandHelp(name: KovoCommandName): string {
  const entry = requireCommand(name);
  const lines = [
    entry.summary,
    '',
    'Usage:',
    ...entry.usage.map((form) => `  ${renderFormUsageLine(entry, form)}`),
  ];
  const flags = referenceFlags(entry);
  if (flags.length > 0) {
    lines.push('', 'Arguments and options:');
    const width = Math.max(...flags.map((item) => item.flag.length));
    for (const item of flags) {
      lines.push(`  ${item.flag.padEnd(width)}  ${item.description}`);
    }
  }
  lines.push(
    '',
    `Result protocol: ${entry.resultProtocol ?? 'none (human process surface)'}`,
    'Exit codes: 0 success/help/version; 1 proof or build findings; 2 usage/config error' +
      ('unknown' in entry.exits && entry.exits.unknown === 2 ? ' or authenticated UNKNOWN' : ''),
  );
  if (entry.examples.length > 0) {
    lines.push('', 'Examples:', ...entry.examples.map((example) => `  ${example}`));
  }
  lines.push('');
  return lines.join('\n');
}

/** @internal Supported generated shell targets. */
export type KovoCompletionShell = 'bash' | 'fish' | 'zsh';

/** @internal True for a supported completion-shell discriminator. */
export function isKovoCompletionShell(value: string | undefined): value is KovoCompletionShell {
  return value === 'bash' || value === 'fish' || value === 'zsh';
}

/** @internal Generate a shell completion program entirely from the command AST. */
export function renderShellCompletion(shell: KovoCompletionShell): string {
  if (shell === 'bash') return renderBashCompletion();
  if (shell === 'fish') return renderFishCompletion();
  return renderZshCompletion();
}

/** @internal Parse command argv from a semantic-schema projection. */
export function parseCommandArgv(
  args: readonly string[],
  spec: CommandArgvSpec,
): ParseCommandArgvResult {
  const optionSpecs = new Map<string, CommandArgvOptionSpec>();
  for (const option of spec.options) {
    optionSpecs.set(option.flag, option);
    for (const alias of option.aliases) optionSpecs.set(alias, option);
  }
  const options = new Map<string, true | string | string[]>();
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') return { error: 'help', ok: false };

    const equalsIndex = arg.indexOf('=');
    const flagToken = equalsIndex > 0 ? arg.slice(0, equalsIndex) : arg;
    const optionSpec = flagToken.startsWith('-') ? optionSpecs.get(flagToken) : undefined;
    if (optionSpec) {
      if (optionSpec.kind === 'boolean') {
        if (equalsIndex > 0) return { error: 'unknown-option', ok: false, option: arg };
        options.set(optionSpec.flag, true);
        continue;
      }

      const optionValue = equalsIndex > 0 ? arg.slice(equalsIndex + 1) : args[index + 1];
      if (!optionValue) {
        return {
          error: 'missing-value',
          message:
            optionSpec.requiresValueMessage ?? `kovo: ${optionSpec.flag} requires a value.\n`,
          ok: false,
        };
      }
      if (equalsIndex <= 0) index += 1;
      if (optionSpec.repeat) {
        const previous = options.get(optionSpec.flag);
        const values =
          previous === undefined
            ? []
            : Array.isArray(previous)
              ? [...previous]
              : [String(previous)];
        values.push(optionValue);
        options.set(optionSpec.flag, values);
      } else {
        options.set(optionSpec.flag, optionValue);
      }
      continue;
    }

    if (arg.startsWith('-')) return { error: 'unknown-option', ok: false, option: arg };
    positionals.push(arg);
  }

  return { ok: true, value: { options, positionals } };
}

/** @internal Render a shared argv parse error. */
export function commandArgvError(
  name: string,
  error: Exclude<ParseCommandArgvResult, { ok: true }>,
  usage: string,
): { message: string; ok: false } {
  if (error.error === 'help') return { message: usage, ok: false };
  if (error.error === 'missing-value') return { message: error.message, ok: false };
  return {
    message: `kovo: unknown ${name} option ${stableValue(error.option)}.\n${usage}`,
    ok: false,
  };
}

/** @internal Require exactly one positional argument. */
export function requireSinglePositional(
  parsed: ParsedCommandArgv,
  options: {
    readonly label: string;
    readonly name: string;
    readonly usage: string;
  },
): { ok: true; value: string } | { message: string; ok: false } {
  const [value, extra] = parsed.positionals;
  if (extra) {
    return {
      message: `kovo: ${options.name} accepts one ${options.label}.\n${options.usage}`,
      ok: false,
    };
  }
  if (!value) {
    return {
      message: `kovo: ${options.name} requires ${articleFor(options.label)} ${options.label}.\n${options.usage}`,
      ok: false,
    };
  }
  return { ok: true, value };
}

/** @internal True when a parsed boolean option appeared. */
export function parsedBooleanOption(parsed: ParsedCommandArgv, flag: string): boolean {
  return parsed.options.get(flag) === true;
}

/** @internal Return a parsed scalar option. */
export function parsedStringOption(parsed: ParsedCommandArgv, flag: string): string | undefined {
  const optionValue = parsed.options.get(flag);
  return typeof optionValue === 'string' ? optionValue : undefined;
}

/** @internal Return a parsed repeatable option. */
export function parsedStringListOption(parsed: ParsedCommandArgv, flag: string): string[] {
  const optionValue = parsed.options.get(flag);
  if (Array.isArray(optionValue)) return [...optionValue];
  return typeof optionValue === 'string' ? [optionValue] : [];
}

/**
 * @internal Semantic programmatic request. Option keys are schema ids
 * (`out`, `severityFloor`), never argv spellings (`--out`,
 * `--severity-floor`).
 */
type KovoSemanticScalarOptionValue<Option> = Option extends {
  readonly value: { readonly kind: 'integer' };
}
  ? number
  : string;

type KovoSemanticOptionValue<Option extends KovoCommandOptionSchema> = Option extends {
  readonly value: KovoCommandOptionSchema['value'];
}
  ? Option extends { readonly repeatable: true }
    ? readonly KovoSemanticScalarOptionValue<Option>[]
    : KovoSemanticScalarOptionValue<Option>
  : boolean;

type KovoSemanticCommandOptions<Entry extends KovoCommandEntry> = {
  readonly [Option in Entry['options'][number] as Option['id']]?: KovoSemanticOptionValue<Option>;
};

/**
 * @internal
 *
 * Semantic programmatic request whose option keys are schema ids rather than
 * argv spellings.
 */
export type KovoSemanticCommandRequest = {
  [Entry in KovoCommandEntry as Entry['name']]: {
    readonly command: Entry['name'];
    readonly kind: 'command';
    readonly operands?: readonly string[];
    readonly options?: KovoSemanticCommandOptions<Entry>;
  };
}[KovoCommandEntry['name']];

/** @internal Serialize a semantic request through the command AST into canonical argv. */
export function commandRequestToArgv(request: KovoSemanticCommandRequest): string[] {
  const entry = requireCommand(request.command);
  const byId = new Map<string, KovoCommandOptionSchema>(
    entry.options.map((item) => [item.id, item]),
  );
  const argv: string[] = [entry.name, ...(request.operands ?? [])];
  const semanticOptions = request.options as
    | Readonly<Record<string, boolean | number | string | readonly (number | string)[] | undefined>>
    | undefined;
  for (const [id, optionValue] of Object.entries(semanticOptions ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (optionValue === undefined) continue;
    const schema = byId.get(id);
    if (!schema) {
      throw new TypeError(`Unknown kovo ${entry.name} semantic option ${JSON.stringify(id)}.`);
    }
    const canonicalFlag = schema.flags[0];
    if (schema.value === undefined) {
      if (typeof optionValue !== 'boolean') {
        throw new TypeError(`Kovo option ${canonicalFlag} is boolean.`);
      }
      if (optionValue === (schema.booleanValue ?? true)) argv.push(canonicalFlag);
      continue;
    }
    if (typeof optionValue === 'boolean') {
      throw new TypeError(`Kovo option ${canonicalFlag} requires ${schema.value.label}.`);
    }
    const values = Array.isArray(optionValue) ? optionValue : [optionValue];
    if (!schema.repeatable && values.length > 1) {
      throw new TypeError(`Kovo option ${canonicalFlag} is not repeatable.`);
    }
    for (const item of values) {
      if (schema.value.kind === 'integer') {
        if (typeof item !== 'number' || !Number.isSafeInteger(item)) {
          throw new TypeError(`Kovo option ${canonicalFlag} requires an integer.`);
        }
      } else if (typeof item !== 'string') {
        throw new TypeError(`Kovo option ${canonicalFlag} requires ${schema.value.label}.`);
      }
      if (
        schema.value.kind === 'enum' &&
        schema.value.values !== undefined &&
        !schema.value.values.includes(String(item))
      ) {
        throw new TypeError(
          `Kovo option ${canonicalFlag} requires ${sentenceList(schema.value.values)}.`,
        );
      }
      argv.push(canonicalFlag, String(item));
    }
  }
  return argv;
}

function requireCommand<Name extends KovoCommandName>(
  name: Name,
): Extract<KovoCommandEntry, { name: Name }> {
  const entry = KOVO_COMMAND_SCHEMA.find((candidate) => candidate.name === name);
  if (!entry) throw new TypeError(`Missing Kovo command schema for ${name}.`);
  return entry as Extract<KovoCommandEntry, { name: Name }>;
}

function requireUsageForm(command: KovoCommandName, id: string): KovoCommandUsageForm {
  const form = requireCommand(command).usage.find((candidate) => candidate.id === id);
  if (!form) throw new TypeError(`Missing Kovo command usage form ${command}/${id}.`);
  return form;
}

function argvSpec(command: KovoCommandName, optionIds?: readonly string[]): CommandArgvSpec {
  const entry = requireCommand(command);
  const acceptedIds = optionIds === undefined ? undefined : new Set(optionIds);
  return Object.freeze({
    command,
    options: Object.freeze(
      entry.options
        .filter((item) => acceptedIds === undefined || acceptedIds.has(item.id))
        .map(argvOptionSpec),
    ),
  });
}

function argvSpecForUsage(command: KovoCommandName, formId: string): CommandArgvSpec {
  const form = requireUsageForm(command, formId);
  const optionIds = form.tokens
    .filter(
      (token): token is Extract<KovoCommandUsageToken, { kind: 'option' }> =>
        token.kind === 'option',
    )
    .map((token) => token.option);
  return Object.freeze({
    ...argvSpec(command, optionIds),
    usageForm: formId,
  });
}

function argvOptionSpec(schema: KovoCommandOptionSchema): CommandArgvOptionSpec {
  return Object.freeze({
    aliases: Object.freeze(schema.flags.slice(1)),
    ...(schema.category === undefined ? {} : { category: schema.category }),
    ...(schema.value?.default === undefined ? {} : { defaultValue: schema.value.default }),
    ...(schema.value?.values === undefined ? {} : { enumValues: schema.value.values }),
    flag: schema.flags[0],
    id: schema.id,
    kind: schema.value === undefined ? 'boolean' : 'value',
    ...(schema.repeatable ? { repeat: true } : {}),
    ...(schema.missingValueMessage === undefined
      ? {}
      : { requiresValueMessage: schema.missingValueMessage }),
    ...(schema.value === undefined ? {} : { valueKind: schema.value.kind }),
  });
}

function renderInlineUsage(entry: KovoCommandSchemaEntry): string {
  return `usage: ${renderJoinedUsage(entry)}`;
}

function renderJoinedUsage(entry: KovoCommandSchemaEntry): string {
  return entry.usage.map((form) => renderFormUsageLine(entry, form)).join(' | ');
}

function renderMultilineUsage(entry: KovoCommandSchemaEntry): readonly string[] {
  return Object.freeze(
    entry.usage.map((form, index) =>
      renderFormUsageLine(entry, form, index === 0 ? 'usage: ' : '       '),
    ),
  );
}

function renderFormUsageLine(
  entry: KovoCommandSchemaEntry,
  form: KovoCommandUsageForm,
  prefix = '',
): string {
  const tokens = form.tokens.map((token) => renderUsageToken(entry, token));
  return `${prefix}kovo ${entry.name}${tokens.length === 0 ? '' : ` ${tokens.join(' ')}`}`;
}

function renderUsageToken(entry: KovoCommandSchemaEntry, token: KovoCommandUsageToken): string {
  if (token.kind === 'group') {
    const syntax = token.tokens.map((item) => renderUsageToken(entry, item)).join(' ');
    return token.required ? syntax : `[${syntax}]`;
  }
  if (token.kind === 'literal') return token.value;
  if (token.kind === 'argument') {
    const core =
      token.value.kind === 'enum' && token.value.values
        ? token.value.values.join('|')
        : !token.required && token.value.kind === 'path'
          ? token.value.label
          : `<${token.value.label}${token.repeatable ? '...' : ''}>`;
    return token.required ? core : `[${core}]`;
  }
  const schema = entry.options.find((item) => item.id === token.option);
  if (!schema) {
    throw new TypeError(
      `Usage form for kovo ${entry.name} references unknown option ${token.option}.`,
    );
  }
  const syntax =
    schema.value === undefined
      ? schema.flags[0]
      : `${schema.flags[0]} <${token.valueLabel ?? schema.value.label}>`;
  return token.required ? syntax : `[${syntax}]`;
}

function referenceFlags(entry: KovoCommandSchemaEntry): readonly CommandFlag[] {
  const rows: CommandFlag[] = [];
  const seen = new Set<string>();
  for (const form of entry.usage) {
    for (const token of form.tokens) {
      if (token.kind === 'group') continue;
      if (
        (token.kind === 'literal' || token.kind === 'argument') &&
        token.description !== undefined
      ) {
        const syntax =
          token.kind === 'literal'
            ? token.value
            : token.value.kind === 'enum' && token.value.values
              ? token.value.values.join('|')
              : `<${token.value.label}${token.repeatable ? '...' : ''}>`;
        if (!seen.has(syntax)) {
          seen.add(syntax);
          rows.push({ description: token.description, flag: syntax });
        }
      }
    }
  }
  for (const schema of entry.options) {
    const syntax = [
      schema.flags.join(', '),
      schema.value === undefined ? '' : ` <${schema.value.label}>`,
      schema.repeatable ? '…' : '',
    ].join('');
    const details = [
      schema.description,
      schema.value?.default === undefined ? '' : ` Default: ${schema.value.default}.`,
      schema.repeatable ? ' Repeatable.' : '',
    ].join('');
    rows.push({ description: details, flag: syntax });
  }
  return Object.freeze(rows.map((row) => Object.freeze(row)));
}

function completionWords(entry: KovoCommandSchemaEntry): string[] {
  const words = new Set<string>();
  for (const schema of entry.options) {
    for (const optionFlag of schema.flags) words.add(optionFlag);
  }
  for (const form of entry.usage) {
    for (const token of form.tokens) {
      if (token.kind === 'group') continue;
      if (token.kind === 'literal') words.add(token.value);
      if (token.kind === 'argument' && token.value.values) {
        for (const item of token.value.values) words.add(item);
      }
    }
  }
  return [...words].sort();
}

function renderBashCompletion(): string {
  const commands = [
    ...orderedCommands().map((entry) => entry.name),
    'completion',
    'help',
    'version',
  ];
  return [
    '# generated by kovo completion bash; do not edit',
    '_kovo_complete() {',
    '  local cur command',
    '  COMPREPLY=()',
    '  cur="${COMP_WORDS[COMP_CWORD]}"',
    '  if (( COMP_CWORD == 1 )); then',
    `    COMPREPLY=( $(compgen -W "${commands.join(' ')} --help --version" -- "$cur") )`,
    '    return',
    '  fi',
    '  command="${COMP_WORDS[1]}"',
    '  case "$command" in',
    ...orderedCommands().map(
      (entry) =>
        `    ${entry.name}) COMPREPLY=( $(compgen -W "${completionWords(entry).join(' ')} --help" -- "$cur") ) ;;`,
    ),
    '    completion) COMPREPLY=( $(compgen -W "bash fish zsh" -- "$cur") ) ;;',
    '  esac',
    '}',
    'complete -F _kovo_complete kovo',
    '',
  ].join('\n');
}

function renderFishCompletion(): string {
  const lines = ['# generated by kovo completion fish; do not edit', 'complete -c kovo -f'];
  for (const entry of orderedCommands()) {
    lines.push(
      `complete -c kovo -n '__fish_use_subcommand' -a '${entry.name}' -d '${fishEscape(entry.summary)}'`,
    );
    for (const word of completionWords(entry)) {
      if (!word.startsWith('--')) continue;
      lines.push(
        `complete -c kovo -n '__fish_seen_subcommand_from ${entry.name}' -l '${word.slice(2)}'`,
      );
    }
  }
  lines.push(
    "complete -c kovo -n '__fish_use_subcommand' -a 'completion help version'",
    "complete -c kovo -n '__fish_seen_subcommand_from completion' -a 'bash fish zsh'",
    '',
  );
  return lines.join('\n');
}

function renderZshCompletion(): string {
  return [
    '#compdef kovo',
    '# generated by kovo completion zsh; do not edit',
    '_kovo() {',
    '  local -a commands',
    '  commands=(',
    ...orderedCommands().map((entry) => `    '${entry.name}:${zshEscape(entry.summary)}'`),
    "    'completion:Generate shell completion'",
    "    'help:Show generated help'",
    "    'version:Show the installed CLI version'",
    '  )',
    "  _arguments '-h[show help]' '--help[show help]' '-V[show version]' '--version[show version]' '1:command:->command' '*::argument:->args'",
    '  case $state in',
    '    command) _describe command commands ;;',
    '    args)',
    '      case $words[2] in',
    ...orderedCommands().map(
      (entry) =>
        `        ${entry.name}) _values 'kovo ${entry.name}' ${completionWords(entry)
          .map((word) => `'${zshEscape(word)}'`)
          .join(' ')} ;;`,
    ),
    "        completion) _values 'shell' bash fish zsh ;;",
    '      esac',
    '    ;;',
    '  esac',
    '}',
    '_kovo "$@"',
    '',
  ].join('\n');
}

function orderedCommands(): KovoCommandEntry[] {
  return [...KOVO_COMMAND_SCHEMA].sort(
    (left, right) => left.order - right.order || left.name.localeCompare(right.name),
  );
}

function readCliVersion(): string {
  const parsed = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version?: unknown;
  };
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new TypeError('@kovojs/cli package.json must contain a version.');
  }
  return parsed.version;
}

function sentenceList(values: readonly string[]): string {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0] ?? '';
  return `${values.slice(0, -1).join(', ')}, or ${values[values.length - 1]}`;
}

function articleFor(label: string): 'a' | 'an' {
  return /^[aeiou]/i.test(label) ? 'an' : 'a';
}

function stableValue(value: string | undefined): string {
  return value === undefined ? '-' : JSON.stringify(value);
}

function fishEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function zshEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "'\\''");
}
