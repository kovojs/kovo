import {
  KOVO_COMMAND_SCHEMA,
  type KovoCommandEntry,
  type KovoCommandOptionSchema,
  type KovoCommandUsageForm,
  type KovoCommandUsageToken,
  type KovoCommandValueSchema,
} from './command-schema.js';

/**
 * @internal Render the standalone public discriminated union from the semantic
 * command AST. Keeping the published declaration free of mapped helper types
 * makes every recursively reachable public type explicit and documented.
 */
export function renderSemanticCommandRequestSource(): string {
  const variants = KOVO_COMMAND_SCHEMA.filter(
    (entry) => entry.processLifecycle === 'one-shot',
  ).flatMap((entry) =>
    entry.usage
      .filter(
        (form) =>
          ('processLifecycle' in form ? form.processLifecycle : entry.processLifecycle) ===
          'one-shot',
      )
      .flatMap((form) =>
        constrainedArgumentSelections(entry, form).map((selection) =>
          renderRequestVariant(entry, form, selection),
        ),
      ),
  );
  return `/**
 * Precise programmatic command union accepted by \`runKovoCommand\`.
 *
 * This source is generated from \`command-schema.ts\`; run
 * \`pnpm generate:cli-command-request\` after changing the semantic command AST.
 * Forms, arguments, options, enum literals, repeats, and boolean polarity are
 * schema-owned. Argv flag spellings are deliberately absent. Long-lived
 * Long-lived command forms stay executable-only until they have an explicit
 * programmatic abort/disposal contract.
 */
export type KovoSemanticCommandRequest =
${variants.join('\n')}
;
`;
}

function renderRequestVariant(
  entry: KovoCommandEntry,
  form: KovoCommandUsageForm,
  argumentSelection: ReadonlyMap<string, string>,
): string {
  const argumentsSource = renderArguments(form, argumentSelection);
  const options = formOptionIds(form);
  const requiredOptions = requiredFormOptionIds(form);
  const optionSchemas = entry.options.filter((option) => options.has(option.id));
  const constrainedFalseOptions = constrainedFalseOptionIds(entry, form, argumentSelection);
  const optionGroups = form.tokens.filter(
    (token): token is Extract<KovoCommandUsageToken, { readonly kind: 'group' }> =>
      token.kind === 'group',
  );
  const optionsSource = renderOptions(
    optionSchemas,
    requiredOptions,
    optionGroups,
    constrainedFalseOptions,
  );
  const optionsRequired = requiredOptions.size > 0 || optionGroups.some((group) => group.required);
  return `  | {
      readonly arguments: ${argumentsSource};
      readonly command: ${tsString(entry.name)};
      readonly form: ${tsString(form.id)};
      readonly options${optionsRequired ? '' : '?'}: ${optionsSource};
    }`;
}

function renderArguments(
  form: KovoCommandUsageForm,
  selection: ReadonlyMap<string, string>,
): string {
  const arguments_ = form.tokens.filter(
    (token): token is Extract<KovoCommandUsageToken, { readonly kind: 'argument' }> =>
      token.kind === 'argument',
  );
  if (arguments_.length === 0) return exactEmptyRecordType();
  return `{
        ${arguments_
          .map(
            (argument) =>
              `readonly ${propertyName(argument.name)}${argument.required ? '' : '?'}: ${
                selection.has(argument.name)
                  ? tsString(selection.get(argument.name)!)
                  : semanticValueType(
                      argument.value,
                      argument.repeatable === true,
                      argument.required,
                    )
              };`,
          )
          .join('\n        ')}
      }`;
}

function renderOptions(
  options: readonly KovoCommandOptionSchema[],
  required: ReadonlySet<string>,
  groups: readonly Extract<KovoCommandUsageToken, { readonly kind: 'group' }>[],
  constrainedFalse: ReadonlySet<string>,
): string {
  const groupedIds = new Set(groups.flatMap((group) => group.tokens.map((token) => token.option)));
  const base = renderOptionRecord(
    options.filter((option) => !groupedIds.has(option.id)),
    required,
    constrainedFalse,
  );
  const constraints = groups.map((group) => renderOptionGroup(group, options, constrainedFalse));
  if (constraints.length === 0) return base;
  return [base, ...constraints].join(' & ');
}

function renderOptionRecord(
  options: readonly KovoCommandOptionSchema[],
  required: ReadonlySet<string>,
  constrainedFalse: ReadonlySet<string>,
): string {
  if (options.length === 0) return exactEmptyRecordType();
  return `{
        ${options
          .map((option) => renderOptionProperty(option, required.has(option.id), constrainedFalse))
          .join('\n        ')}
      }`;
}

function renderOptionGroup(
  group: Extract<KovoCommandUsageToken, { readonly kind: 'group' }>,
  options: readonly KovoCommandOptionSchema[],
  constrainedFalse: ReadonlySet<string>,
): string {
  const schemas = group.tokens.map((member) => {
    const schema = options.find((option) => option.id === member.option);
    if (schema === undefined) {
      throw new TypeError(`Semantic option group references unknown option ${member.option}.`);
    }
    return { member, schema };
  });
  const selected = `{
        ${schemas
          .map(({ member, schema }) =>
            renderOptionProperty(schema, member.required === true, constrainedFalse),
          )
          .join('\n        ')}
      }`;
  if (group.required) return selected;
  const absent = `{
        ${schemas
          .map(({ schema }) => `readonly ${propertyName(schema.id)}?: never;`)
          .join('\n        ')}
      }`;
  return `(${absent} | ${selected})`;
}

function renderOptionProperty(
  option: KovoCommandOptionSchema,
  required: boolean,
  constrainedFalse: ReadonlySet<string>,
): string {
  const property = propertyName(option.id);
  if (constrainedFalse.has(option.id)) {
    return `readonly ${property}${required ? '' : '?'}: false;`;
  }
  return `readonly ${property}${required ? '' : '?'}: ${semanticOptionType(option, required)};`;
}

function semanticOptionType(option: KovoCommandOptionSchema, required: boolean): string {
  if (option.value === undefined) {
    if (!required) return 'boolean';
    return option.booleanValue === false ? 'false' : 'true';
  }
  return semanticValueType(option.value, option.repeatable === true, required);
}

function semanticValueType(
  value: KovoCommandValueSchema,
  repeatable: boolean,
  nonEmpty: boolean,
): string {
  const scalar =
    value.values === undefined
      ? value.kind === 'integer'
        ? 'number'
        : 'string'
      : value.values.map(tsString).join(' | ');
  if (!repeatable) return scalar;
  const item = scalar.includes(' | ') ? `(${scalar})` : scalar;
  return nonEmpty ? `readonly [${item}, ...${item}[]]` : `readonly ${item}[]`;
}

function exactEmptyRecordType(): string {
  return '{ readonly [key: PropertyKey]: never }';
}

function constrainedArgumentSelections(
  entry: KovoCommandEntry,
  form: KovoCommandUsageForm,
): readonly ReadonlyMap<string, string>[] {
  const argumentNames = [
    ...new Set((form.optionRequiresArgument ?? []).map((constraint) => constraint.argument)),
  ];
  let selections: ReadonlyMap<string, string>[] = [new Map()];
  for (const argumentName of argumentNames) {
    const argument = form.tokens.find(
      (token): token is Extract<KovoCommandUsageToken, { readonly kind: 'argument' }> =>
        token.kind === 'argument' && token.name === argumentName,
    );
    if (
      argument === undefined ||
      !argument.required ||
      argument.repeatable === true ||
      argument.value.kind !== 'enum' ||
      argument.value.values === undefined ||
      argument.value.values.length === 0
    ) {
      throw new TypeError(
        `Kovo ${entry.name}/${form.id} option constraint requires a required enum argument ${argumentName}.`,
      );
    }
    selections = selections.flatMap((selection) =>
      argument.value.values!.map((value) => {
        const next = new Map(selection);
        next.set(argumentName, value);
        return next;
      }),
    );
  }
  return selections;
}

function constrainedFalseOptionIds(
  entry: KovoCommandEntry,
  form: KovoCommandUsageForm,
  selection: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const constrainedFalse = new Set<string>();
  for (const constraint of form.optionRequiresArgument ?? []) {
    const option = entry.options.find((candidate) => candidate.id === constraint.option) as
      | KovoCommandOptionSchema
      | undefined;
    if (
      option === undefined ||
      option.value !== undefined ||
      (option.booleanValue ?? true) !== true
    ) {
      throw new TypeError(
        `Kovo ${entry.name}/${form.id} argument constraint requires a positive boolean option ${constraint.option}.`,
      );
    }
    const selected = selection.get(constraint.argument);
    if (selected === undefined) {
      throw new TypeError(
        `Kovo ${entry.name}/${form.id} did not select constrained argument ${constraint.argument}.`,
      );
    }
    if (!constraint.values.includes(selected)) constrainedFalse.add(option.id);
  }
  return constrainedFalse;
}

function formOptionIds(form: KovoCommandUsageForm): Set<string> {
  const ids = new Set<string>();
  for (const token of form.tokens) {
    if (token.kind === 'option') ids.add(token.option);
    if (token.kind === 'group') {
      for (const child of token.tokens) ids.add(child.option);
    }
  }
  return ids;
}

function requiredFormOptionIds(form: KovoCommandUsageForm): Set<string> {
  const ids = new Set<string>();
  for (const token of form.tokens) {
    if (token.kind === 'option' && token.required === true) ids.add(token.option);
    if (token.kind === 'group' && token.required) {
      for (const child of token.tokens) {
        if (child.required === true) ids.add(child.option);
      }
    }
  }
  return ids;
}

function propertyName(value: string): string {
  return /^[$A-Z_a-z][$\w]*$/u.test(value) ? value : tsString(value);
}

function tsString(value: string): string {
  return `'${value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')}'`;
}
