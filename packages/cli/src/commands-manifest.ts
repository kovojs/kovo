import { readFileSync } from 'node:fs';

import {
  KOVO_CLI_SCHEMA,
  KOVO_COMMAND_SCHEMA,
  type KovoCommandEntry,
  type KovoCommandName,
  type KovoCommandOptionSchema,
  type KovoCommandSchemaEntry,
  type KovoCommandUsageForm,
  type KovoCommandUsageToken,
  type KovoCommandValueSchema,
  type KovoMetaCommandName,
  type KovoMetaCommandSchemaEntry,
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

/** @internal Generated CLI version line. */
export function formatCliVersion(): string {
  return `${KOVO_CLI_SCHEMA.name} ${KOVO_CLI_VERSION}\n`;
}

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
  readonly booleanValue?: boolean;
  readonly category?: KovoCommandOptionSchema['category'];
  readonly defaultValue?: boolean | number | string;
  readonly enumValues?: readonly string[];
  readonly flag: `--${string}`;
  readonly id: string;
  readonly invalidValueMessage?: string;
  readonly kind: CommandArgvOptionKind;
  readonly maximum?: number;
  readonly minimum?: number;
  readonly repeat?: boolean;
  readonly requiresValueMessage?: string;
  readonly valueKind?: Exclude<KovoCommandOptionSchema['value'], undefined>['kind'];
}

/** @internal One command or command-form argv parser schema. */
export interface CommandArgvSpec {
  readonly command: KovoCommandName | KovoMetaCommandName;
  readonly options: readonly CommandArgvOptionSpec[];
  readonly requiredOptions?: readonly string[];
  readonly usageForm?: string;
  readonly validatePositionals?: boolean;
}

/** @internal One value produced by the semantic argv parser. */
export type ParsedCommandValue = boolean | number | string | readonly (number | string)[];

/** @internal Parsed argv result before command-specific semantic validation. */
export interface ParsedCommandArgv {
  readonly arguments: ReadonlyMap<string, number | string | readonly (number | string)[]>;
  readonly options: ReadonlyMap<string, ParsedCommandValue>;
  readonly positionals: readonly string[];
}

/** @internal Shared argv parser result. */
export type ParseCommandArgvResult =
  | { readonly ok: true; readonly value: ParsedCommandArgv }
  | { readonly error: 'help'; readonly ok: false }
  | { readonly error: 'invalid-value'; readonly message: string; readonly ok: false }
  | { readonly error: 'missing-value'; readonly message: string; readonly ok: false }
  | { readonly error: 'repeated-option'; readonly ok: false; readonly option: string }
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
const META_COMMAND_REGISTRY = new Map<KovoMetaCommandName, KovoMetaCommandSchemaEntry>(
  KOVO_CLI_SCHEMA.metaCommands.map((entry) => [entry.name, entry]),
);
const META_COMMAND_ALIAS_REGISTRY = new Map<string, KovoMetaCommandSchemaEntry>(
  KOVO_CLI_SCHEMA.metaCommands.flatMap((entry) =>
    entry.aliases.map((alias) => [alias, entry] as const),
  ),
);
const GLOBAL_OPTION_REGISTRY = new Map<string, KovoCommandOptionSchema>(
  KOVO_CLI_SCHEMA.globalOptions.flatMap((option) =>
    option.flags.map((flag) => [flag, option] as const),
  ),
);

/** @internal Resolve a canonical command name or declared alias. */
export function resolveCommand(name: string | undefined): KovoCommandEntry | undefined {
  if (name === undefined) return undefined;
  return COMMAND_REGISTRY.get(name as KovoCommandName) ?? COMMAND_ALIAS_REGISTRY.get(name);
}

function resolveMetaCommand(name: string | undefined): KovoMetaCommandSchemaEntry | undefined {
  if (name === undefined) return undefined;
  return (
    META_COMMAND_REGISTRY.get(name as KovoMetaCommandName) ?? META_COMMAND_ALIAS_REGISTRY.get(name)
  );
}

function globalOptionForFlag(flag: string): KovoCommandOptionSchema | undefined {
  return GLOBAL_OPTION_REGISTRY.get(flag);
}

function requestedGlobalOptions(args: readonly string[]): KovoCommandOptionSchema[] {
  return args
    .map(globalOptionForFlag)
    .filter((option): option is KovoCommandOptionSchema => option !== undefined);
}

function singleGlobalOption(
  command: string,
  options: readonly KovoCommandOptionSchema[],
):
  | { readonly message: string; readonly ok: false }
  | { readonly ok: true; readonly value: KovoCommandOptionSchema } {
  const selected = options[0];
  if (
    selected === undefined ||
    options.length > 1 ||
    options.some((option) => option.id !== selected.id)
  ) {
    return {
      message: `${KOVO_CLI_SCHEMA.name}: ${command} accepts one global help or version option.\n`,
      ok: false,
    };
  }
  return { ok: true, value: selected };
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
  const cliName = KOVO_CLI_SCHEMA.name;
  const lines = [
    `Kovo ${KOVO_CLI_VERSION}`,
    '',
    'Usage:',
    `  ${cliName} <command> [options]`,
    ...KOVO_CLI_SCHEMA.metaCommands.flatMap((entry) =>
      entry.usage.map((form) => `  ${renderFormUsageLine(entry, form)}`),
    ),
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
    ...KOVO_CLI_SCHEMA.globalOptions.map(
      (option) => `  ${option.flags.join(', ').padEnd(15)} ${option.description}`,
    ),
    '',
    `Run \`${cliName} help <command>\` for command details.`,
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

/** @internal Generated help for one schema-owned meta command. */
export function formatMetaCommandHelp(name: KovoMetaCommandName): string {
  const entry = requireMetaCommand(name);
  return [
    entry.summary,
    '',
    'Usage:',
    ...entry.usage.map((form) => `  ${renderFormUsageLine(entry, form)}`),
    '',
    'Examples:',
    ...entry.examples.map((example) => `  ${example}`),
    '',
  ].join('\n');
}

/** @internal Supported generated shell targets. */
export type KovoCompletionShell = 'bash' | 'fish' | 'zsh';

/** @internal A schema-parsed invocation handled before capability dispatch. */
export type KovoMetaInvocation =
  | { readonly kind: 'command-help'; readonly command: KovoCommandName }
  | { readonly kind: 'completion'; readonly shell: KovoCompletionShell }
  | { readonly kind: 'meta-help'; readonly command: KovoMetaCommandName }
  | { readonly kind: 'root-help' }
  | { readonly kind: 'version' };

/** @internal Result of parsing the schema-owned global/meta grammar. */
export type KovoMetaInvocationParseResult =
  | { readonly handled: false; readonly ok: true }
  | { readonly handled: true; readonly ok: true; readonly value: KovoMetaInvocation }
  | { readonly message: string; readonly ok: false };

/** @internal True for a supported completion-shell discriminator. */
export function isKovoCompletionShell(value: string | undefined): value is KovoCompletionShell {
  const completion = requireMetaCommand('completion');
  const shell = completion.usage[0]?.tokens.find(
    (token): token is Extract<KovoCommandUsageToken, { kind: 'argument' }> =>
      token.kind === 'argument' && token.name === 'shell',
  );
  return shell?.value.values?.includes(value ?? '') === true;
}

/** @internal Parse root aliases, meta commands, and capability help/version from the CLI AST. */
export function parseKovoMetaInvocation(args: readonly string[]): KovoMetaInvocationParseResult {
  const [first, ...rest] = args;
  if (first === undefined) return { handled: true, ok: true, value: { kind: 'root-help' } };

  const globalOption = globalOptionForFlag(first);
  if (globalOption !== undefined) {
    if (rest.length > 0) {
      return {
        message: `${KOVO_CLI_SCHEMA.name}: ${globalOption.flags[0]} does not accept arguments.\n`,
        ok: false,
      };
    }
    return {
      handled: true,
      ok: true,
      value: { kind: globalOption.id === 'help' ? 'root-help' : 'version' },
    };
  }

  const meta = resolveMetaCommand(first);
  if (meta !== undefined) {
    const metaGlobals = requestedGlobalOptions(rest);
    if (metaGlobals.length > 0) {
      const selected = singleGlobalOption(meta.name, metaGlobals);
      if (!selected.ok) return selected;
      return {
        handled: true,
        ok: true,
        value:
          selected.value.id === 'help'
            ? { command: meta.name, kind: 'meta-help' }
            : { kind: 'version' },
      };
    }
    const parsed = parseCommandArgv(rest, metaArgvSpec(meta));
    if (!parsed.ok) {
      return {
        message: commandArgvError(meta.name, parsed, formatMetaCommandUsage(meta)).message,
        ok: false,
      };
    }
    if (meta.name === 'version') {
      return { handled: true, ok: true, value: { kind: 'version' } };
    }
    if (meta.name === 'completion') {
      const shell = parsedStringArgument(parsed.value, 'shell');
      if (!isKovoCompletionShell(shell)) {
        throw new TypeError('Kovo completion schema admitted an unsupported shell.');
      }
      return { handled: true, ok: true, value: { kind: 'completion', shell } };
    }
    const target = parsedStringArgument(parsed.value, 'command');
    if (target === undefined) {
      return { handled: true, ok: true, value: { kind: 'root-help' } };
    }
    const capability = resolveCommand(target);
    if (capability !== undefined) {
      return {
        handled: true,
        ok: true,
        value: { command: capability.name, kind: 'command-help' },
      };
    }
    const targetMeta = resolveMetaCommand(target);
    if (targetMeta !== undefined) {
      return {
        handled: true,
        ok: true,
        value: { command: targetMeta.name, kind: 'meta-help' },
      };
    }
    throw new TypeError('Kovo help schema admitted an unknown command.');
  }

  const capability = resolveCommand(first);
  if (capability === undefined) return { handled: false, ok: true };
  const capabilityGlobals = requestedGlobalOptions(rest);
  if (capabilityGlobals.length === 0) return { handled: false, ok: true };
  const selected = singleGlobalOption(capability.name, capabilityGlobals);
  if (!selected.ok) return selected;
  return {
    handled: true,
    ok: true,
    value:
      selected.value.id === 'help'
        ? { command: capability.name, kind: 'command-help' }
        : { kind: 'version' },
  };
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
  const options = new Map<string, ParsedCommandValue>();
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
        if (options.has(optionSpec.id)) {
          return { error: 'repeated-option', ok: false, option: optionSpec.flag };
        }
        options.set(optionSpec.id, optionSpec.booleanValue ?? true);
        continue;
      }

      const rawValue = equalsIndex > 0 ? arg.slice(equalsIndex + 1) : args[index + 1];
      if (!rawValue) {
        return {
          error: 'missing-value',
          message:
            optionSpec.requiresValueMessage ?? `kovo: ${optionSpec.flag} requires a value.\n`,
          ok: false,
        };
      }
      if (equalsIndex <= 0) index += 1;
      const parsedValue = parseArgvValue(rawValue, optionSpec);
      if (!parsedValue.ok) return parsedValue;
      if (optionSpec.repeat) {
        const previous = options.get(optionSpec.id);
        const values =
          previous === undefined
            ? []
            : Array.isArray(previous)
              ? [...previous]
              : [String(previous)];
        values.push(parsedValue.value);
        options.set(optionSpec.id, values);
      } else {
        if (options.has(optionSpec.id)) {
          return { error: 'repeated-option', ok: false, option: optionSpec.flag };
        }
        options.set(optionSpec.id, parsedValue.value);
      }
      continue;
    }

    if (arg.startsWith('-')) return { error: 'unknown-option', ok: false, option: arg };
    positionals.push(arg);
  }

  for (const optionSpec of spec.options) {
    if (optionSpec.defaultValue !== undefined && !options.has(optionSpec.id)) {
      options.set(optionSpec.id, optionSpec.defaultValue);
    }
  }
  for (const requiredOption of spec.requiredOptions ?? []) {
    if (options.has(requiredOption)) continue;
    const optionSpec = spec.options.find((candidate) => candidate.id === requiredOption);
    return {
      error: 'missing-value',
      message:
        optionSpec?.requiresValueMessage ??
        `kovo: ${optionSpec?.flag ?? requiredOption} is required.\n`,
      ok: false,
    };
  }

  const parsedArguments =
    spec.validatePositionals === true
      ? parseUsageFormArguments(spec, positionals)
      : {
          ok: true as const,
          value: new Map<string, number | string | readonly (number | string)[]>(),
        };
  if (!parsedArguments.ok) return parsedArguments;

  return {
    ok: true,
    value: {
      arguments: parsedArguments.value,
      options,
      positionals,
    },
  };
}

/** @internal Render a shared argv parse error. */
export function commandArgvError(
  name: string,
  error: Exclude<ParseCommandArgvResult, { ok: true }>,
  usage: string,
): { message: string; ok: false } {
  if (error.error === 'help') return { message: usage, ok: false };
  if (error.error === 'missing-value' || error.error === 'invalid-value') {
    return { message: appendUsage(error.message, usage), ok: false };
  }
  if (error.error === 'repeated-option') {
    return {
      message: `kovo: ${name} option ${error.option} may appear only once.\n${usage}`,
      ok: false,
    };
  }
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
export function parsedBooleanOption(parsed: ParsedCommandArgv, id: string): boolean {
  return parsed.options.get(id) === true;
}

/** @internal Return a parsed scalar option. */
export function parsedStringOption(parsed: ParsedCommandArgv, id: string): string | undefined {
  const optionValue = parsed.options.get(id);
  return typeof optionValue === 'string' ? optionValue : undefined;
}

/** @internal Return a parsed integer option. */
export function parsedIntegerOption(parsed: ParsedCommandArgv, id: string): number | undefined {
  const optionValue = parsed.options.get(id);
  return typeof optionValue === 'number' ? optionValue : undefined;
}

/** @internal Return a parsed repeatable option. */
export function parsedStringListOption(parsed: ParsedCommandArgv, id: string): string[] {
  const optionValue = parsed.options.get(id);
  if (Array.isArray(optionValue)) {
    return optionValue.filter((value): value is string => typeof value === 'string');
  }
  return typeof optionValue === 'string' ? [optionValue] : [];
}

/** @internal Return a schema-validated named positional argument. */
export function parsedStringArgument(parsed: ParsedCommandArgv, id: string): string | undefined {
  const value = parsed.arguments.get(id);
  return typeof value === 'string' ? value : undefined;
}

/** @internal Require a schema default or explicit string option. */
export function requiredParsedStringOption(parsed: ParsedCommandArgv, id: string): string {
  const value = parsedStringOption(parsed, id);
  if (value === undefined) {
    throw new TypeError(`Kovo command schema did not produce required option ${id}.`);
  }
  return value;
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

function requireMetaCommand<Name extends KovoMetaCommandName>(
  name: Name,
): Extract<(typeof KOVO_CLI_SCHEMA.metaCommands)[number], { name: Name }> {
  const entry = KOVO_CLI_SCHEMA.metaCommands.find((candidate) => candidate.name === name);
  if (entry === undefined) throw new TypeError(`Missing Kovo meta-command schema for ${name}.`);
  return entry as Extract<(typeof KOVO_CLI_SCHEMA.metaCommands)[number], { name: Name }>;
}

function requireCliEntry(
  name: KovoCommandName | KovoMetaCommandName,
): KovoCommandEntry | KovoMetaCommandSchemaEntry {
  const capability = KOVO_COMMAND_SCHEMA.find((candidate) => candidate.name === name);
  if (capability !== undefined) return capability;
  const meta = KOVO_CLI_SCHEMA.metaCommands.find((candidate) => candidate.name === name);
  if (meta !== undefined) return meta;
  throw new TypeError(`Missing Kovo CLI schema for ${name}.`);
}

function requireUsageForm(command: KovoCommandName, id: string): KovoCommandUsageForm {
  const form = requireCommand(command).usage.find((candidate) => candidate.id === id);
  if (!form) throw new TypeError(`Missing Kovo command usage form ${command}/${id}.`);
  return form;
}

function argvSpec(command: KovoCommandName, optionIds?: readonly string[]): CommandArgvSpec {
  const entry = requireCommand(command);
  const acceptedIds = optionIds === undefined ? undefined : new Set(optionIds);
  const soleForm = entry.usage.length === 1 ? entry.usage[0] : undefined;
  return Object.freeze({
    command,
    options: Object.freeze(
      entry.options
        .filter((item) => acceptedIds === undefined || acceptedIds.has(item.id))
        .map(argvOptionSpec),
    ),
    ...(soleForm === undefined
      ? {}
      : {
          requiredOptions: requiredUsageOptionIds(soleForm),
          usageForm: soleForm.id,
          validatePositionals: true,
        }),
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
    requiredOptions: requiredUsageOptionIds(form),
    usageForm: formId,
    validatePositionals: false,
  });
}

function metaArgvSpec(entry: KovoMetaCommandSchemaEntry): CommandArgvSpec {
  const form = entry.usage[0];
  if (form === undefined) throw new TypeError(`Missing Kovo meta usage form for ${entry.name}.`);
  return Object.freeze({
    command: entry.name,
    options: Object.freeze(entry.options.map(argvOptionSpec)),
    requiredOptions: requiredUsageOptionIds(form),
    usageForm: form.id,
    validatePositionals: true,
  });
}

function formatMetaCommandUsage(entry: KovoMetaCommandSchemaEntry): string {
  return entry.usage.map((form) => `usage: ${renderFormUsageLine(entry, form)}`).join('\n');
}

function argvOptionSpec(schema: KovoCommandOptionSchema): CommandArgvOptionSpec {
  return Object.freeze({
    aliases: Object.freeze(schema.flags.slice(1)),
    ...(schema.booleanValue === undefined ? {} : { booleanValue: schema.booleanValue }),
    ...(schema.category === undefined ? {} : { category: schema.category }),
    ...(schema.value?.default === undefined && schema.defaultBoolean === undefined
      ? {}
      : { defaultValue: schema.value?.default ?? schema.defaultBoolean }),
    ...(schema.value?.values === undefined ? {} : { enumValues: schema.value.values }),
    flag: schema.flags[0],
    id: schema.id,
    ...(schema.invalidValueMessage === undefined
      ? {}
      : { invalidValueMessage: schema.invalidValueMessage }),
    kind: schema.value === undefined ? 'boolean' : 'value',
    ...(schema.value?.maximum === undefined ? {} : { maximum: schema.value.maximum }),
    ...(schema.value?.minimum === undefined ? {} : { minimum: schema.value.minimum }),
    ...(schema.repeatable ? { repeat: true } : {}),
    ...(schema.missingValueMessage === undefined
      ? {}
      : { requiresValueMessage: schema.missingValueMessage }),
    ...(schema.value === undefined ? {} : { valueKind: schema.value.kind }),
  });
}

function parseArgvValue(
  rawValue: string,
  schema: CommandArgvOptionSpec,
):
  | { readonly error: 'invalid-value'; readonly message: string; readonly ok: false }
  | { readonly ok: true; readonly value: number | string } {
  const parsed = parseSemanticValue(rawValue, {
    kind: schema.valueKind ?? 'string',
    label: schema.flag,
    ...(schema.enumValues === undefined ? {} : { values: schema.enumValues }),
    ...(schema.maximum === undefined ? {} : { maximum: schema.maximum }),
    ...(schema.minimum === undefined ? {} : { minimum: schema.minimum }),
  });
  if (parsed.ok) return parsed;
  return {
    error: 'invalid-value',
    message:
      schema.invalidValueMessage?.replaceAll('{value}', stableValue(rawValue)) ??
      `kovo: ${schema.flag} requires ${valueExpectation(schema)}; received ${stableValue(rawValue)}.\n`,
    ok: false,
  };
}

function parseUsageFormArguments(
  spec: CommandArgvSpec,
  positionals: readonly string[],
):
  | { readonly error: 'invalid-value'; readonly message: string; readonly ok: false }
  | { readonly error: 'missing-value'; readonly message: string; readonly ok: false }
  | {
      readonly ok: true;
      readonly value: Map<string, number | string | readonly (number | string)[]>;
    } {
  const entry = requireCliEntry(spec.command);
  const form = entry.usage.find((candidate) => candidate.id === spec.usageForm);
  if (form === undefined) {
    throw new TypeError(`Missing Kovo command usage form ${spec.command}/${spec.usageForm}.`);
  }
  const semanticArguments = new Map<string, number | string | readonly (number | string)[]>();
  const usageTokens: readonly KovoCommandUsageToken[] = form.tokens;
  const positionalTokens = usageTokens.filter(
    (
      token,
    ): token is
      | Extract<KovoCommandUsageToken, { kind: 'argument' }>
      | Extract<KovoCommandUsageToken, { kind: 'literal' }> =>
      token.kind === 'argument' || token.kind === 'literal',
  );
  let position = 0;
  for (const token of positionalTokens) {
    if (token.kind === 'literal') {
      if (positionals[position] !== token.value) {
        return {
          error: 'invalid-value',
          message: `kovo: ${entry.name} requires ${token.value}.\n`,
          ok: false,
        };
      }
      position += 1;
      continue;
    }

    if (token.repeatable) {
      const values: (number | string)[] = [];
      for (; position < positionals.length; position += 1) {
        const parsed = parseSemanticValue(positionals[position]!, token.value);
        if (!parsed.ok) {
          return {
            error: 'invalid-value',
            message:
              token.invalidValueMessage ??
              `kovo: ${entry.name} requires ${valueSchemaExpectation(token.value)}.\n`,
            ok: false,
          };
        }
        values.push(parsed.value);
      }
      if (token.required && values.length === 0) {
        return {
          error: 'missing-value',
          message:
            token.missingValueMessage ??
            `kovo: ${entry.name} requires ${articleFor(token.value.label)} ${token.value.label}.\n`,
          ok: false,
        };
      }
      semanticArguments.set(token.name, values);
      continue;
    }

    const rawValue = positionals[position];
    if (rawValue === undefined) {
      if (!token.required) continue;
      return {
        error: 'missing-value',
        message:
          token.missingValueMessage ??
          `kovo: ${entry.name} requires ${articleFor(token.value.label)} ${token.value.label}.\n`,
        ok: false,
      };
    }
    const parsed = parseSemanticValue(rawValue, token.value);
    if (!parsed.ok) {
      return {
        error: 'invalid-value',
        message:
          token.invalidValueMessage ??
          `kovo: ${entry.name} requires ${valueSchemaExpectation(token.value)}; received ${stableValue(rawValue)}.\n`,
        ok: false,
      };
    }
    semanticArguments.set(token.name, parsed.value);
    position += 1;
  }
  if (position < positionals.length) {
    const argumentToken = positionalTokens.find(
      (token): token is Extract<KovoCommandUsageToken, { kind: 'argument' }> =>
        token.kind === 'argument',
    );
    return {
      error: 'invalid-value',
      message:
        argumentToken?.unexpectedValueMessage ??
        `kovo: ${entry.name} received unexpected argument ${stableValue(positionals[position])}.\n`,
      ok: false,
    };
  }
  return { ok: true, value: semanticArguments };
}

function parseSemanticValue(
  rawValue: string,
  schema: KovoCommandValueSchema,
): { readonly ok: false } | { readonly ok: true; readonly value: number | string } {
  if (schema.kind === 'integer') {
    if (!/^-?\d+$/u.test(rawValue)) return { ok: false };
    const parsed = Number(rawValue);
    if (
      !Number.isSafeInteger(parsed) ||
      (schema.minimum !== undefined && parsed < schema.minimum) ||
      (schema.maximum !== undefined && parsed > schema.maximum)
    ) {
      return { ok: false };
    }
    return { ok: true, value: parsed };
  }
  if (schema.kind === 'enum' && schema.values !== undefined && !schema.values.includes(rawValue)) {
    return { ok: false };
  }
  if (schema.kind === 'url') {
    try {
      new URL(rawValue);
    } catch {
      return { ok: false };
    }
  }
  return { ok: true, value: rawValue };
}

function requiredUsageOptionIds(form: KovoCommandUsageForm): readonly string[] {
  return Object.freeze(
    form.tokens.flatMap((token) => {
      if (token.kind === 'option') return token.required ? [token.option] : [];
      if (token.kind !== 'group' || !token.required) return [];
      return token.tokens.filter((item) => item.required).map((item) => item.option);
    }),
  );
}

function valueExpectation(schema: CommandArgvOptionSpec): string {
  if (schema.enumValues !== undefined) return sentenceList(schema.enumValues);
  if (schema.valueKind === 'integer') {
    if (schema.minimum !== undefined && schema.maximum !== undefined) {
      return `an integer from ${schema.minimum} through ${schema.maximum}`;
    }
    return 'an integer';
  }
  if (schema.valueKind === 'url') return 'an absolute URL';
  return schema.valueKind ?? 'a value';
}

function valueSchemaExpectation(schema: KovoCommandValueSchema): string {
  if (schema.values !== undefined) return sentenceList(schema.values);
  return schema.kind === 'integer' ? 'an integer' : schema.label;
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
  entry: KovoRenderableCommandSchema,
  form: KovoCommandUsageForm,
  prefix = '',
): string {
  const tokens = form.tokens.map((token) => renderUsageToken(entry, token));
  return `${prefix}${KOVO_CLI_SCHEMA.name} ${entry.name}${
    tokens.length === 0 ? '' : ` ${tokens.join(' ')}`
  }`;
}

function renderUsageToken(
  entry: KovoRenderableCommandSchema,
  token: KovoCommandUsageToken,
): string {
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

function referenceFlags(entry: KovoRenderableCommandSchema): readonly CommandFlag[] {
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

function completionWords(entry: KovoRenderableCommandSchema): string[] {
  const words = new Set<string>();
  for (const schema of entry.options) {
    for (const optionFlag of schema.flags) words.add(optionFlag);
    for (const enumValue of schema.value?.values ?? []) words.add(enumValue);
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

type KovoRenderableCommandSchema = Pick<KovoCommandSchemaEntry, 'name' | 'options' | 'usage'>;

function renderBashCompletion(): string {
  const entries = orderedCliEntries();
  const commands = entries.flatMap((entry) => [entry.name, ...entry.aliases]);
  const globals = globalCompletionWords();
  return [
    '# generated by kovo completion bash; do not edit',
    '_kovo_complete() {',
    '  local cur command',
    '  COMPREPLY=()',
    '  cur="${COMP_WORDS[COMP_CWORD]}"',
    '  if (( COMP_CWORD == 1 )); then',
    `    COMPREPLY=( $(compgen -W "${[...commands, ...globals].join(' ')}" -- "$cur") )`,
    '    return',
    '  fi',
    '  command="${COMP_WORDS[1]}"',
    '  case "$command" in',
    ...entries.map(
      (entry) =>
        `    ${[entry.name, ...entry.aliases].join('|')}) COMPREPLY=( $(compgen -W "${[
          ...completionWords(entry),
          ...globals,
        ].join(' ')}" -- "$cur") ) ;;`,
    ),
    '  esac',
    '}',
    'complete -F _kovo_complete kovo',
    '',
  ].join('\n');
}

function renderFishCompletion(): string {
  const lines = ['# generated by kovo completion fish; do not edit', 'complete -c kovo -f'];
  for (const entry of orderedCliEntries()) {
    lines.push(
      `complete -c kovo -n '__fish_use_subcommand' -a '${entry.name}' -d '${fishEscape(entry.summary)}'`,
    );
    for (const alias of entry.aliases) {
      lines.push(
        `complete -c kovo -n '__fish_use_subcommand' -a '${alias}' -d '${fishEscape(entry.summary)}'`,
      );
    }
    for (const word of completionWords(entry)) {
      if (word.startsWith('--')) {
        lines.push(
          `complete -c kovo -n '__fish_seen_subcommand_from ${entry.name}' -l '${word.slice(2)}'`,
        );
      } else {
        lines.push(
          `complete -c kovo -n '__fish_seen_subcommand_from ${entry.name}' -a '${fishEscape(word)}'`,
        );
      }
    }
    for (const option of KOVO_CLI_SCHEMA.globalOptions) {
      const longFlag = option.flags.find((flag) => flag.startsWith('--'));
      if (longFlag !== undefined) {
        lines.push(
          `complete -c kovo -n '__fish_seen_subcommand_from ${entry.name}' -l '${longFlag.slice(2)}'`,
        );
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

function renderZshCompletion(): string {
  const entries = orderedCliEntries();
  const globalArguments = KOVO_CLI_SCHEMA.globalOptions
    .flatMap((option) => option.flags.map((flag) => `'${flag}[${zshEscape(option.description)}]'`))
    .join(' ');
  return [
    '#compdef kovo',
    '# generated by kovo completion zsh; do not edit',
    '_kovo() {',
    '  local -a commands',
    '  commands=(',
    ...entries.flatMap((entry) =>
      [entry.name, ...entry.aliases].map((name) => `    '${name}:${zshEscape(entry.summary)}'`),
    ),
    '  )',
    `  _arguments ${globalArguments} '1:command:->command' '*::argument:->args'`,
    '  case $state in',
    '    command) _describe command commands ;;',
    '    args)',
    '      case $words[2] in',
    ...entries.map(
      (entry) =>
        `        ${[entry.name, ...entry.aliases].join('|')}) _values 'kovo ${entry.name}' ${[
          ...completionWords(entry),
          ...globalCompletionWords(),
        ]
          .map((word) => `'${zshEscape(word)}'`)
          .join(' ')} ;;`,
    ),
    '      esac',
    '    ;;',
    '  esac',
    '}',
    '_kovo "$@"',
    '',
  ].join('\n');
}

function orderedCliEntries(): readonly (KovoCommandEntry | KovoMetaCommandSchemaEntry)[] {
  return [...orderedCommands(), ...KOVO_CLI_SCHEMA.metaCommands];
}

function globalCompletionWords(): string[] {
  return KOVO_CLI_SCHEMA.globalOptions.flatMap((option) => [...option.flags]);
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

function appendUsage(message: string, usage: string): string {
  const normalizedUsage = usage.trim();
  if (normalizedUsage.length === 0 || message.includes(normalizedUsage)) return message;
  return `${message.trimEnd()}\n${usage}`;
}

function fishEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function zshEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "'\\''");
}
