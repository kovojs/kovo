/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked through pinned Reflect.apply. */
import {
  KOVO_CLI_SCHEMA,
  KOVO_COMMAND_SCHEMA,
  type KovoCommandCompilerRealm,
  type KovoCommandEntry,
  type KovoCommandName,
  type KovoCommandOptionSchema,
  type KovoCommandProcessLifecycle,
  type KovoCommandSchemaEntry,
  type KovoCommandUsageForm,
  type KovoCommandUsageToken,
  type KovoCommandValueSchema,
  type KovoMetaCommandName,
  type KovoMetaCommandSchemaEntry,
} from './command-schema.js';
import { readCliPackageVersion } from './package-version.js';
import type { KovoSemanticCommandRequest } from './semantic-command-request.generated.js';

const nativeMapGet = Map.prototype.get;
const nativeReflectApply = Reflect.apply;

export type {
  KovoAsyncCommandName,
  KovoCommandEntry,
  KovoCommandName,
  KovoSyncCommandName,
} from './command-schema.js';
export type { KovoSemanticCommandRequest } from './semantic-command-request.generated.js';

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

/** @internal Usage line emitted for authenticated local docs retrieval. */
export const DOCS_USAGE = renderInlineUsage(requireCommand('docs'));

/** @internal Schema-owned authenticated local-docs result protocol. */
export const DOCS_RESULT_PROTOCOL = requireCommand('docs').resultProtocol;

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

type SemanticScalarValue<Schema> = Schema extends {
  readonly values: readonly (infer Value extends string)[];
}
  ? Value
  : Schema extends { readonly kind: 'integer' }
    ? number
    : string;

type SemanticArgumentValue<Token> = Token extends {
  readonly repeatable: true;
  readonly value: infer Schema;
}
  ? readonly SemanticScalarValue<Schema>[]
  : Token extends { readonly value: infer Schema }
    ? SemanticScalarValue<Schema>
    : never;

type FormArgumentToken<Form> = Form extends {
  readonly tokens: readonly (infer Token)[];
}
  ? Extract<Token, { readonly kind: 'argument' }>
  : never;

type RequiredFormArguments<Form> = {
  readonly [Token in FormArgumentToken<Form> as Token extends { readonly required: true }
    ? Token['name']
    : never]: SemanticArgumentValue<Token>;
};

type OptionalFormArguments<Form> = {
  readonly [Token in FormArgumentToken<Form> as Token extends { readonly required: false }
    ? Token['name']
    : never]?: SemanticArgumentValue<Token>;
};

type FormOptionToken<Form> = Form extends {
  readonly tokens: readonly (infer Token)[];
}
  ? Token extends { readonly kind: 'option' }
    ? Token
    : Token extends { readonly kind: 'group'; readonly tokens: readonly (infer GroupToken)[] }
      ? GroupToken
      : never
  : never;

type FormOptionId<Form> =
  FormOptionToken<Form> extends infer Token
    ? Token extends { readonly option: infer Id extends string }
      ? Id
      : never
    : never;

type EntryOption<Entry, Id extends string> = Entry extends {
  readonly options: readonly (infer Option)[];
}
  ? Extract<Option, { readonly id: Id }>
  : never;

type SemanticOptionValue<Option> = Option extends {
  readonly value: infer Schema;
}
  ? Option extends { readonly repeatable: true }
    ? readonly SemanticScalarValue<Schema>[]
    : SemanticScalarValue<Schema>
  : boolean;

type RequiredOptionIdFromToken<Token> = Token extends {
  readonly kind: 'option';
  readonly option: infer Id extends string;
  readonly required: true;
}
  ? Id
  : Token extends {
        readonly kind: 'group';
        readonly required: true;
        readonly tokens: readonly (infer GroupToken)[];
      }
    ? GroupToken extends {
        readonly option: infer Id extends string;
        readonly required: true;
      }
      ? Id
      : never
    : never;

type RequiredFormOptionId<Form> = Form extends {
  readonly tokens: readonly (infer Token)[];
}
  ? RequiredOptionIdFromToken<Token>
  : never;

type SemanticFormOptions<Entry, Form> = {
  readonly [Id in FormOptionId<Form>]?: SemanticOptionValue<EntryOption<Entry, Id>>;
} & {
  readonly [Id in RequiredFormOptionId<Form>]-?: SemanticOptionValue<EntryOption<Entry, Id>>;
};

type ParsedFormOptions<Entry, Form> = {
  readonly [Id in FormOptionId<Form>]: EntryOption<Entry, Id> extends {
    readonly value: infer Schema;
  }
    ? EntryOption<Entry, Id> extends { readonly repeatable: true }
      ? readonly SemanticScalarValue<Schema>[]
      : Id extends RequiredFormOptionId<Form>
        ? SemanticScalarValue<Schema>
        : EntryOption<Entry, Id> extends { readonly value: { readonly default: unknown } }
          ? SemanticScalarValue<Schema>
          : SemanticScalarValue<Schema> | undefined
    : boolean;
};

type CommandForm<Entry> = Entry extends { readonly usage: readonly (infer Form)[] } ? Form : never;

type ParsedInvocationFor<Entry, Form> = Entry extends {
  readonly name: infer Name extends KovoCommandName;
}
  ? Form extends { readonly id: infer Id extends string }
    ? {
        readonly arguments: RequiredFormArguments<Form> & OptionalFormArguments<Form>;
        readonly command: Name;
        readonly form: Id;
        readonly options: ParsedFormOptions<Entry, Form>;
      }
    : never
  : never;

/** @internal Form-discriminated semantic result produced by the command AST parser. */
export type KovoParsedCommandInvocation<
  Name extends KovoCommandName = KovoCommandName,
  Entry extends KovoCommandEntry = Extract<KovoCommandEntry, { readonly name: Name }>,
> = CommandForm<Entry> extends infer Form ? ParsedInvocationFor<Entry, Form> : never;

/** @internal Exact success/error result of schema-owned command parsing. */
export type KovoCommandInvocationParseResult<Name extends KovoCommandName = KovoCommandName> =
  | { readonly ok: true; readonly value: KovoParsedCommandInvocation<Name> }
  | { readonly error: 'help' | 'usage'; readonly message: string; readonly ok: false };

type KovoCommandFormId<Name extends KovoCommandName> = KovoParsedCommandInvocation<Name>['form'];

type SemanticRequestOptions<Entry, Form> = [RequiredFormOptionId<Form>] extends [never]
  ? { readonly options?: SemanticFormOptions<Entry, Form> }
  : { readonly options: SemanticFormOptions<Entry, Form> };

type SemanticRequestFor<Entry, Form> = Entry extends {
  readonly name: infer Name extends KovoCommandName;
}
  ? Form extends { readonly id: infer Id extends string }
    ? {
        readonly arguments: RequiredFormArguments<Form> & OptionalFormArguments<Form>;
        readonly command: Name;
        readonly form: Id;
      } & SemanticRequestOptions<Entry, Form>
    : never
  : never;

/** @internal Mapped oracle used to prove the generated public union matches the command AST. */
export type DerivedKovoSemanticCommandRequest = KovoCommandEntry extends infer Entry
  ? Entry extends KovoCommandEntry
    ? Entry extends { readonly processLifecycle: 'one-shot' }
      ? CommandForm<Entry> extends infer Form
        ? Form extends { readonly processLifecycle: 'long-lived' }
          ? never
          : SemanticRequestFor<Entry, Form>
        : never
      : never
    : never
  : never;

/** @internal One command-reference projection. */
export interface CommandManifestEntry {
  readonly aliases: readonly string[];
  readonly async?: boolean;
  readonly category: KovoCommandSchemaEntry['category'];
  readonly compilerRealm: KovoCommandCompilerRealm;
  readonly examples: readonly string[];
  readonly exits: KovoCommandSchemaEntry['exits'];
  readonly flags: readonly CommandFlag[];
  readonly name: KovoCommandName;
  readonly noArgsOrder: number;
  readonly processLifecycle: KovoCommandProcessLifecycle;
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
      compilerRealm: entry.compilerRealm,
      examples: entry.examples,
      exits: entry.exits,
      flags: referenceFlags(entry),
      name: entry.name,
      noArgsOrder: entry.order,
      processLifecycle: entry.processLifecycle,
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

assertUniqueKovoCommandVocabulary([...KOVO_COMMAND_SCHEMA, ...KOVO_CLI_SCHEMA.metaCommands]);

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
  return mapGet(COMMAND_REGISTRY, name as KovoCommandName) ?? mapGet(COMMAND_ALIAS_REGISTRY, name);
}

function resolveMetaCommand(name: string | undefined): KovoMetaCommandSchemaEntry | undefined {
  if (name === undefined) return undefined;
  return (
    mapGet(META_COMMAND_REGISTRY, name as KovoMetaCommandName) ??
    mapGet(META_COMMAND_ALIAS_REGISTRY, name)
  );
}

function globalOptionForFlag(flag: string): KovoCommandOptionSchema | undefined {
  return mapGet(GLOBAL_OPTION_REGISTRY, flag);
}

function mapGet<Key, Value>(map: ReadonlyMap<Key, Value>, key: Key): Value | undefined {
  return nativeReflectApply(nativeMapGet, map, [key]) as Value | undefined;
}

/** @internal Executable posture derived from a canonical command or declared alias. */
export interface KovoBinInvocationPosture {
  readonly compilerRealm: KovoCommandCompilerRealm;
  readonly processLifecycle: KovoCommandProcessLifecycle;
}

const META_INVOCATION_POSTURE: KovoBinInvocationPosture = Object.freeze({
  compilerRealm: 'unlocked',
  processLifecycle: 'one-shot',
});

/**
 * @internal Resolve executable security and lifetime behavior through the same
 * schema and alias registries as dispatch. Informational/meta paths never
 * evaluate authored modules and therefore retain the one-shot unlocked posture.
 */
export function resolveKovoBinInvocationPosture(args: readonly string[]): KovoBinInvocationPosture {
  const meta = parseKovoMetaInvocation(args);
  if (meta.ok && meta.handled) return META_INVOCATION_POSTURE;
  const command = resolveCommand(args[0]);
  if (command === undefined) return META_INVOCATION_POSTURE;
  const parsed = parseKovoCommandInvocation(command.name, args.slice(1));
  const form =
    parsed.ok === true
      ? command.usage.find((candidate) => candidate.id === parsed.value.form)
      : undefined;
  return Object.freeze({
    compilerRealm: command.compilerRealm,
    processLifecycle:
      form !== undefined && 'processLifecycle' in form
        ? form.processLifecycle
        : command.processLifecycle,
  });
}

/**
 * @internal Reject command, meta-command, or alias collisions before any
 * adapter creates a lossy Map from the semantic vocabulary.
 */
export function assertUniqueKovoCommandVocabulary(
  entries: readonly { readonly aliases: readonly string[]; readonly name: string }[],
): void {
  const ownerByToken = new Map<string, string>();
  for (const entry of entries) {
    for (const token of [entry.name, ...entry.aliases]) {
      const owner = ownerByToken.get(token);
      if (owner !== undefined) {
        throw new TypeError(
          `Kovo command token ${JSON.stringify(token)} is owned by both ${owner} and ${entry.name}.`,
        );
      }
      ownerByToken.set(token, entry.name);
    }
  }
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
    (token) => token.kind === 'argument' && token.name === 'shell',
  );
  return (
    value !== undefined &&
    shell?.kind === 'argument' &&
    shell.value.values?.some((candidate) => candidate === value) === true
  );
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
    const parsed = parseEntryInvocation(meta, rest);
    if (!parsed.ok) return { message: parsed.message, ok: false };
    if (meta.name === 'version') {
      return { handled: true, ok: true, value: { kind: 'version' } };
    }
    if (meta.name === 'completion') {
      const shell =
        typeof parsed.value.arguments.shell === 'string' ? parsed.value.arguments.shell : undefined;
      if (!isKovoCompletionShell(shell)) {
        throw new TypeError('Kovo completion schema admitted an unsupported shell.');
      }
      return { handled: true, ok: true, value: { kind: 'completion', shell } };
    }
    const target =
      typeof parsed.value.arguments.command === 'string'
        ? parsed.value.arguments.command
        : undefined;
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

type ParsedSemanticValue = boolean | number | string | readonly (number | string)[];

interface TokenizedCommandArgv {
  readonly options: ReadonlyMap<string, ParsedSemanticValue>;
  readonly positionals: readonly string[];
}

interface ParsedEntryForm {
  readonly arguments: Readonly<Record<string, number | string | readonly (number | string)[]>>;
  readonly form: KovoCommandUsageForm;
  readonly options: Readonly<Record<string, ParsedSemanticValue | undefined>>;
  readonly score: number;
}

interface FormParseFailure {
  readonly message: string;
  readonly priority: number;
  readonly score: number;
}

type EntryInvocationParseResult =
  | { readonly ok: true; readonly value: ParsedEntryForm }
  | {
      readonly error: 'help' | 'usage';
      readonly message: string;
      readonly ok: false;
      readonly priority?: number;
      readonly score?: number;
    };

/** @internal Parse and select one concrete command form from the semantic AST. */
export function parseKovoCommandInvocation<Name extends KovoCommandName>(
  name: Name,
  args: readonly string[],
): KovoCommandInvocationParseResult<Name> {
  const entry = requireCommand(name);
  const parsed = parseEntryInvocation(entry, args);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    value: {
      arguments: parsed.value.arguments,
      command: name,
      form: parsed.value.form.id,
      options: parsed.value.options,
    } as KovoParsedCommandInvocation<Name>,
  };
}

/**
 * @internal Parse one known command form with form-scoped option diagnostics
 * and usage, while retaining the same semantic AST as whole-command dispatch.
 */
export function parseKovoCommandFormInvocation<
  Name extends KovoCommandName,
  Form extends KovoCommandFormId<Name>,
>(
  name: Name,
  formId: Form,
  args: readonly string[],
):
  | {
      readonly ok: true;
      readonly value: Extract<KovoParsedCommandInvocation<Name>, { readonly form: Form }>;
    }
  | { readonly error: 'help' | 'usage'; readonly message: string; readonly ok: false } {
  const entry = requireCommand(name);
  const form = entry.usage.find((candidate) => candidate.id === formId);
  if (form === undefined) {
    throw new TypeError(`Missing Kovo command usage form ${name}/${formId}.`);
  }
  const usage = `usage: ${renderFormUsageLine(entry, form)}`;
  const admittedOptionIds = new Set(formOptionIds(form));
  const tokenized = tokenizeCommandArgv(entry, args, usage, {
    displayName: `${entry.name} ${form.id}`,
    options: entry.options.filter((option) => admittedOptionIds.has(option.id)),
  });
  if (!tokenized.ok) return tokenized;
  const parsed = parseEntryForm(entry, form, tokenized.value, usage);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    value: {
      arguments: parsed.value.arguments,
      command: name,
      form: form.id,
      options: parsed.value.options,
    } as Extract<KovoParsedCommandInvocation<Name>, { readonly form: Form }>,
  };
}

/** @internal True when a parsed command form requires the async dispatcher. */
export function isAsyncKovoCommandInvocation(invocation: KovoParsedCommandInvocation): boolean {
  const entry = requireCommand(invocation.command);
  if ('async' in entry && entry.async === true) return true;
  return entry.usage.some(
    (form) => form.id === invocation.form && 'async' in form && form.async === true,
  );
}

/** @internal Serialize one precise semantic form request through the same AST parser. */
export function commandRequestToArgv(request: KovoSemanticCommandRequest): string[] {
  const entry = requireCommand(request.command);
  const form = entry.usage.find((candidate) => candidate.id === request.form);
  if (form === undefined) {
    throw new TypeError(
      `Unknown kovo ${entry.name} semantic form ${JSON.stringify(request.form)}.`,
    );
  }
  const semanticArguments = request.arguments as Readonly<Record<string, unknown>>;
  const semanticOptions = (request.options ?? {}) as Readonly<Record<string, unknown>>;
  const argv: string[] = [];
  const admittedArguments = new Set<string>();
  for (const token of positionalFormTokens(form)) {
    if (token.kind === 'literal') {
      argv.push(token.value);
      continue;
    }
    admittedArguments.add(token.name);
    const argumentValue = semanticArguments[token.name];
    if (token.repeatable) {
      if (!Array.isArray(argumentValue)) {
        throw new TypeError(`Kovo ${entry.name} form ${form.id} requires ${token.name} values.`);
      }
      for (const item of argumentValue) argv.push(serializeSemanticValue(item, token.value));
      continue;
    }
    if (argumentValue === undefined) {
      if (token.required) {
        throw new TypeError(`Kovo ${entry.name} form ${form.id} requires argument ${token.name}.`);
      }
      continue;
    }
    argv.push(serializeSemanticValue(argumentValue, token.value));
  }
  rejectSurplusSemanticKeys(semanticArguments, admittedArguments, `${entry.name} arguments`);

  const admittedOptions = new Set(formOptionIds(form));
  rejectSurplusSemanticKeys(semanticOptions, admittedOptions, `${entry.name} options`);
  for (const rawOption of entry.options) {
    const option: KovoCommandOptionSchema = rawOption;
    if (!admittedOptions.has(option.id)) continue;
    const optionValue = semanticOptions[option.id];
    if (optionValue === undefined) continue;
    if (option.value === undefined) {
      if (typeof optionValue !== 'boolean') {
        throw new TypeError(`Kovo option ${option.flags[0]} is boolean.`);
      }
      if (optionValue === (option.booleanValue ?? true)) argv.push(option.flags[0]);
      continue;
    }
    const values = Array.isArray(optionValue) ? optionValue : [optionValue];
    if (!option.repeatable && values.length > 1) {
      throw new TypeError(`Kovo option ${option.flags[0]} is not repeatable.`);
    }
    for (const item of values) {
      argv.push(option.flags[0], serializeSemanticValue(item, option.value));
    }
  }

  const verified = parseKovoCommandInvocation(entry.name, argv);
  if (!verified.ok || verified.value.form !== form.id) {
    throw new TypeError(
      verified.ok
        ? `Kovo semantic request selected ${verified.value.form}, expected ${form.id}.`
        : verified.message.trim(),
    );
  }
  return [entry.name, ...argv];
}

function parseEntryInvocation(
  entry: KovoCommandEntry | KovoMetaCommandSchemaEntry,
  args: readonly string[],
): EntryInvocationParseResult {
  const literalForm = literalPrefixedForm(entry, args);
  const forms = literalForm === undefined ? entry.usage : [literalForm];
  const usage =
    literalForm === undefined
      ? entryUsageForError(entry)
      : `usage: ${renderFormUsageLine(entry, literalForm)}`;
  const admittedOptionIds =
    literalForm === undefined ? undefined : new Set(formOptionIds(literalForm));
  const tokenized = tokenizeCommandArgv(entry, args, usage, {
    ...(literalForm === undefined ? {} : { displayName: `${entry.name} ${literalForm.id}` }),
    ...(admittedOptionIds === undefined
      ? {}
      : { options: entry.options.filter((option) => admittedOptionIds.has(option.id)) }),
  });
  if (!tokenized.ok) return tokenized;
  const successes: ParsedEntryForm[] = [];
  const failures: FormParseFailure[] = [];
  for (const form of forms) {
    const parsed = parseEntryForm(entry, form, tokenized.value, usage);
    if (parsed.ok) successes.push(parsed.value);
    else
      failures.push({
        message: parsed.message,
        priority: parsed.priority ?? 0,
        score: parsed.score ?? 0,
      });
  }
  if (successes.length > 0) {
    successes.sort((left, right) => right.score - left.score);
    return { ok: true, value: successes[0]! };
  }
  failures.sort((left, right) => right.priority - left.priority || right.score - left.score);
  const failure = failures[0];
  return {
    error: 'usage',
    message: failure?.message ?? usage,
    ok: false,
    ...(failure === undefined ? {} : { priority: failure.priority, score: failure.score }),
  };
}

function literalPrefixedForm(
  entry: KovoCommandEntry | KovoMetaCommandSchemaEntry,
  args: readonly string[],
): KovoCommandUsageForm | undefined {
  const first = args[0];
  if (first === undefined || first.startsWith('-')) return undefined;
  const candidates = entry.usage.filter((form) => {
    const positional = positionalFormTokens(form);
    return positional[0]?.kind === 'literal' && positional[0].value === first;
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

function tokenizeCommandArgv(
  entry: KovoCommandEntry | KovoMetaCommandSchemaEntry,
  args: readonly string[],
  usage: string,
  context: {
    readonly displayName?: string;
    readonly options?: readonly KovoCommandOptionSchema[];
  } = {},
):
  | { readonly ok: true; readonly value: TokenizedCommandArgv }
  | { readonly error: 'help' | 'usage'; readonly message: string; readonly ok: false } {
  const optionsByFlag = new Map<string, KovoCommandOptionSchema>();
  for (const option of context.options ?? entry.options) {
    for (const flag of option.flags) optionsByFlag.set(flag, option);
  }
  const displayName = context.displayName ?? entry.name;
  const options = new Map<string, ParsedSemanticValue>();
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;
    if (globalOptionForFlag(argument)?.id === 'help') {
      return { error: 'help', message: usage, ok: false };
    }
    const equalsIndex = argument.indexOf('=');
    const flag = equalsIndex > 0 ? argument.slice(0, equalsIndex) : argument;
    const schema = flag.startsWith('-') ? optionsByFlag.get(flag) : undefined;
    if (schema === undefined) {
      if (argument.startsWith('-')) {
        return {
          error: 'usage',
          message: `kovo: unknown ${displayName} option ${stableValue(argument)}.\n${usage}`,
          ok: false,
        };
      }
      positionals.push(argument);
      continue;
    }
    if (schema.value === undefined) {
      if (equalsIndex > 0) {
        return {
          error: 'usage',
          message: `kovo: unknown ${displayName} option ${stableValue(argument)}.\n${usage}`,
          ok: false,
        };
      }
      if (options.has(schema.id)) {
        return {
          error: 'usage',
          message: `kovo: ${displayName} option ${schema.flags[0]} may appear only once.\n${usage}`,
          ok: false,
        };
      }
      options.set(schema.id, schema.booleanValue ?? true);
      continue;
    }
    const following = args[index + 1];
    const rawValue = equalsIndex > 0 ? argument.slice(equalsIndex + 1) : following;
    const followingFlag =
      equalsIndex <= 0 && following !== undefined
        ? optionsByFlag.get(
            following.includes('=') ? following.slice(0, following.indexOf('=')) : following,
          )
        : undefined;
    if (rawValue === undefined || rawValue.length === 0 || followingFlag !== undefined) {
      return {
        error: 'usage',
        message: appendUsage(
          schema.missingValueMessage ?? `kovo: ${schema.flags[0]} requires a value.\n`,
          usage,
        ),
        ok: false,
      };
    }
    if (equalsIndex <= 0) index += 1;
    const parsed = parseSemanticValue(rawValue, schema.value);
    if (!parsed.ok) {
      return {
        error: 'usage',
        message: appendUsage(
          schema.invalidValueMessage?.replaceAll('{value}', stableValue(rawValue)) ??
            `kovo: ${schema.flags[0]} requires ${valueSchemaExpectation(schema.value)}; received ${stableValue(rawValue)}.\n`,
          usage,
        ),
        ok: false,
      };
    }
    if (!schema.repeatable && options.has(schema.id)) {
      return {
        error: 'usage',
        message: `kovo: ${displayName} option ${schema.flags[0]} may appear only once.\n${usage}`,
        ok: false,
      };
    }
    if (schema.repeatable) {
      const previous = options.get(schema.id);
      const values = Array.isArray(previous) ? [...previous] : [];
      values.push(parsed.value);
      options.set(schema.id, values);
    } else {
      options.set(schema.id, parsed.value);
    }
  }
  return {
    ok: true,
    value: {
      options,
      positionals: Object.freeze(positionals),
    },
  };
}

function parseEntryForm(
  entry: KovoCommandEntry | KovoMetaCommandSchemaEntry,
  form: KovoCommandUsageForm,
  tokenized: TokenizedCommandArgv,
  usage: string,
): EntryInvocationParseResult {
  const admittedOptionIds = new Set(formOptionIds(form));
  for (const optionId of tokenized.options.keys()) {
    if (!admittedOptionIds.has(optionId)) {
      return { error: 'usage', message: usage, ok: false, priority: 5, score: 0 };
    }
  }
  const semanticArguments: Record<string, number | string | readonly (number | string)[]> = {};
  const positionalTokens = positionalFormTokens(form);
  let position = 0;
  let score = 0;
  for (const [tokenIndex, token] of positionalTokens.entries()) {
    if (token.kind === 'literal') {
      if (tokenized.positionals[position] !== token.value) {
        return { error: 'usage', message: usage, ok: false, priority: 10, score };
      }
      position += 1;
      score += 100;
      continue;
    }
    if (token.repeatable) {
      const values: (number | string)[] = [];
      for (; position < tokenized.positionals.length; position += 1) {
        const rawValue = tokenized.positionals[position]!;
        const parsed = parseSemanticValue(rawValue, token.value);
        if (!parsed.ok) {
          return formValueFailure(entry, token, rawValue, usage, score);
        }
        values.push(parsed.value);
        score += token.value.kind === 'enum' ? 20 : 1;
      }
      if (token.required && values.length === 0) {
        return formMissingArgument(entry, token, usage, score);
      }
      semanticArguments[token.name] = Object.freeze(values);
      continue;
    }
    const rawValue = tokenized.positionals[position];
    if (rawValue === undefined) {
      if (token.required) return formMissingArgument(entry, token, usage, score);
      continue;
    }
    const parsed = parseSemanticValue(rawValue, token.value);
    if (!parsed.ok) {
      const laterCapacity = positionalCapacity(positionalTokens.slice(tokenIndex + 1));
      const remaining = tokenized.positionals.length - position;
      if (!token.required && remaining <= laterCapacity) continue;
      return formValueFailure(entry, token, rawValue, usage, score);
    }
    semanticArguments[token.name] = parsed.value;
    position += 1;
    score += token.value.kind === 'enum' ? 20 : 1;
  }
  if (position < tokenized.positionals.length) {
    const argumentToken = positionalTokens.find(
      (token): token is Extract<KovoCommandUsageToken, { kind: 'argument' }> =>
        token.kind === 'argument',
    );
    return {
      error: 'usage',
      message:
        argumentToken?.unexpectedValueMessage === undefined
          ? prefixUsage(usage, argumentToken?.usageErrorPrefix)
          : appendUsage(argumentToken.unexpectedValueMessage, usage),
      ok: false,
      priority: 12,
      score,
    };
  }

  const semanticOptions: Record<string, ParsedSemanticValue | undefined> = {};
  for (const optionId of admittedOptionIds) {
    const schema = entry.options.find((option) => option.id === optionId) as
      | KovoCommandOptionSchema
      | undefined;
    if (schema === undefined) {
      throw new TypeError(`Kovo ${entry.name}/${form.id} references unknown option ${optionId}.`);
    }
    const explicit = tokenized.options.get(optionId);
    if (explicit !== undefined) {
      semanticOptions[optionId] = Array.isArray(explicit) ? Object.freeze([...explicit]) : explicit;
    } else if (schema.value?.default !== undefined) {
      semanticOptions[optionId] = schema.value.default;
    } else if (schema.repeatable) {
      semanticOptions[optionId] = Object.freeze([]);
    } else if (schema.value === undefined) {
      semanticOptions[optionId] = schema.defaultBoolean ?? !(schema.booleanValue ?? true);
    } else {
      semanticOptions[optionId] = undefined;
    }
  }
  for (const token of form.tokens) {
    if (token.kind === 'option' && token.required) {
      const schema = entry.options.find((option) => option.id === token.option) as
        | KovoCommandOptionSchema
        | undefined;
      if (!tokenized.options.has(token.option)) {
        return requiredOptionFailure(entry, schema, usage, score);
      }
      score += 50;
    }
    if (token.kind === 'group') {
      const groupWasSelected = token.tokens.some((member) => tokenized.options.has(member.option));
      if (!token.required && !groupWasSelected) continue;
      for (const member of token.tokens) {
        if (!member.required || tokenized.options.has(member.option)) continue;
        const schema = entry.options.find((option) => option.id === member.option) as
          | KovoCommandOptionSchema
          | undefined;
        return requiredOptionFailure(entry, schema, usage, score);
      }
    }
  }
  for (const constraint of form.optionRequiresArgument ?? []) {
    if (
      semanticOptions[constraint.option] === true &&
      !constraint.values.includes(String(semanticArguments[constraint.argument]))
    ) {
      return { error: 'usage', message: usage, ok: false, priority: 30, score };
    }
  }
  for (const constraint of form.optionValues ?? []) {
    const selected = semanticOptions[constraint.option];
    if (typeof selected !== 'string' || !constraint.values.includes(selected)) {
      return {
        error: 'usage',
        message: appendUsage(constraint.invalidValueMessage ?? '', usage),
        ok: false,
        priority: 30,
        score,
      };
    }
  }
  return {
    ok: true,
    value: {
      arguments: Object.freeze(semanticArguments),
      form,
      options: Object.freeze(semanticOptions),
      score,
    },
  };
}

function formMissingArgument(
  entry: KovoCommandEntry | KovoMetaCommandSchemaEntry,
  token: Extract<KovoCommandUsageToken, { kind: 'argument' }>,
  usage: string,
  score: number,
): EntryInvocationParseResult {
  return {
    error: 'usage',
    message: appendUsage(
      token.missingValueMessage ??
        `kovo: ${entry.name} requires ${articleFor(token.value.label)} ${token.value.label}.\n`,
      usage,
    ),
    ok: false,
    priority: 25,
    score,
  };
}

function formValueFailure(
  entry: KovoCommandEntry | KovoMetaCommandSchemaEntry,
  token: Extract<KovoCommandUsageToken, { kind: 'argument' }>,
  rawValue: string,
  usage: string,
  score: number,
): EntryInvocationParseResult {
  const invalidValueMessage = token.invalidValueMessage
    ?.replaceAll('{value}', stableValue(rawValue))
    .replaceAll('{suggestion}', semanticValueSuggestion(rawValue, token.value));
  return {
    error: 'usage',
    message:
      invalidValueMessage !== undefined && token.invalidValueUsage === 'omit'
        ? invalidValueMessage
        : appendUsage(
            invalidValueMessage ??
              `kovo: ${entry.name} requires ${valueSchemaExpectation(token.value)}; received ${stableValue(rawValue)}.\n`,
            usage,
          ),
    ok: false,
    priority: token.invalidValueMessage === undefined ? 20 : 35,
    score,
  };
}

function semanticValueSuggestion(rawValue: string, schema: KovoCommandValueSchema): string {
  if (schema.suggestValues !== true || schema.values === undefined) return '';
  const normalized = rawValue.toLocaleLowerCase('en-US');
  const candidates = schema.values
    .map((candidate) => ({
      candidate,
      distance: editDistance(normalized, candidate.toLocaleLowerCase('en-US')),
    }))
    .sort(
      (left, right) =>
        left.distance - right.distance || left.candidate.localeCompare(right.candidate),
    );
  const nearest = candidates[0];
  const limit = Math.max(1, Math.min(3, Math.floor(normalized.length / 3)));
  return nearest !== undefined && nearest.distance <= limit
    ? ` Did you mean ${stableValue(nearest.candidate)}?`
    : '';
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? Number.POSITIVE_INFINITY) + 1,
        (previous[rightIndex] ?? Number.POSITIVE_INFINITY) + 1,
        (previous[rightIndex - 1] ?? Number.POSITIVE_INFINITY) +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    for (let index = 0; index < current.length; index += 1) previous[index] = current[index]!;
  }
  return previous[right.length] ?? right.length;
}

function requiredOptionFailure(
  entry: KovoCommandEntry | KovoMetaCommandSchemaEntry,
  schema: KovoCommandOptionSchema | undefined,
  usage: string,
  score: number,
): EntryInvocationParseResult {
  return {
    error: 'usage',
    message: appendUsage(
      schema?.missingValueMessage ??
        `kovo: ${entry.name} requires ${schema?.flags[0] ?? 'an option'}.\n`,
      usage,
    ),
    ok: false,
    priority: 25,
    score,
  };
}

function positionalFormTokens(
  form: KovoCommandUsageForm,
): readonly (
  | Extract<KovoCommandUsageToken, { kind: 'argument' }>
  | Extract<KovoCommandUsageToken, { kind: 'literal' }>
)[] {
  return form.tokens.filter(
    (
      token,
    ): token is
      | Extract<KovoCommandUsageToken, { kind: 'argument' }>
      | Extract<KovoCommandUsageToken, { kind: 'literal' }> =>
      token.kind === 'argument' || token.kind === 'literal',
  );
}

function positionalCapacity(
  tokens: readonly (
    | Extract<KovoCommandUsageToken, { kind: 'argument' }>
    | Extract<KovoCommandUsageToken, { kind: 'literal' }>
  )[],
): number {
  return tokens.some((token) => token.kind === 'argument' && token.repeatable)
    ? Number.POSITIVE_INFINITY
    : tokens.length;
}

function formOptionIds(form: KovoCommandUsageForm): string[] {
  return form.tokens.flatMap((token) => {
    if (token.kind === 'option') return [token.option];
    if (token.kind === 'group') return token.tokens.map((member) => member.option);
    return [];
  });
}

function entryUsageForError(entry: KovoCommandEntry | KovoMetaCommandSchemaEntry): string {
  const usage = `usage: ${renderJoinedUsage(entry)}`;
  return 'usageErrorPrefix' in entry ? prefixUsage(usage, entry.usageErrorPrefix) : usage;
}

function serializeSemanticValue(value: unknown, schema: KovoCommandValueSchema): string {
  const rawValue = typeof value === 'number' ? String(value) : value;
  if (typeof rawValue !== 'string' || !parseSemanticValue(rawValue, schema).ok) {
    throw new TypeError(`Kovo semantic value requires ${valueSchemaExpectation(schema)}.`);
  }
  return rawValue;
}

function rejectSurplusSemanticKeys(
  value: Readonly<Record<string, unknown>>,
  admitted: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!admitted.has(key)) {
      throw new TypeError(`Unknown Kovo ${label} field ${JSON.stringify(key)}.`);
    }
  }
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

function requireUsageForm(command: KovoCommandName, id: string): KovoCommandUsageForm {
  const form = requireCommand(command).usage.find((candidate) => candidate.id === id);
  if (!form) throw new TypeError(`Missing Kovo command usage form ${command}/${id}.`);
  return form;
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

function valueSchemaExpectation(schema: KovoCommandValueSchema): string {
  if (schema.values !== undefined) return sentenceList(schema.values);
  return schema.kind === 'integer' ? 'an integer' : schema.label;
}

function renderInlineUsage(entry: KovoCommandSchemaEntry): string {
  return `usage: ${renderJoinedUsage(entry)}`;
}

function renderJoinedUsage(entry: KovoRenderableCommandSchema): string {
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
  const tokens = form.tokens.map((token) => renderUsageToken(entry, form, token));
  return `${prefix}${KOVO_CLI_SCHEMA.name} ${entry.name}${
    tokens.length === 0 ? '' : ` ${tokens.join(' ')}`
  }`;
}

function renderUsageToken(
  entry: KovoRenderableCommandSchema,
  form: KovoCommandUsageForm,
  token: KovoCommandUsageToken,
): string {
  if (token.kind === 'group') {
    const syntax = token.tokens.map((item) => renderUsageToken(entry, form, item)).join(' ');
    return token.required ? syntax : `[${syntax}]`;
  }
  if (token.kind === 'literal') return token.value;
  if (token.kind === 'argument') {
    const core =
      token.value.kind === 'enum' && token.value.values && token.value.usage !== 'label'
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
      : `${schema.flags[0]} <${
          token.valueLabel ??
          form.optionValues
            ?.find((constraint) => constraint.option === token.option)
            ?.values.join('|') ??
          schema.value.label
        }>`;
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
            : token.value.kind === 'enum' && token.value.values && token.value.usage !== 'label'
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
  return readCliPackageVersion();
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

function prefixUsage(usage: string, prefix: 'kovo' | undefined): string {
  return prefix === 'kovo' && !usage.startsWith('kovo: ') ? `kovo: ${usage}` : usage;
}

function fishEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function zshEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "'\\''");
}
