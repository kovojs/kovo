#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const defaultSinkPolicyPath = 'packages/core/src/internal/sink-policy.ts';

export const defaultBlessedSinkFiles = [
  defaultSinkPolicyPath,
  'packages/core/src/internal/sql-safety.ts',
  'packages/core/src/index.ts',
  'packages/server/src/command.ts',
  'packages/server/src/file.ts',
  'packages/server/src/response.ts',
  'packages/server/src/route.ts',
];

export const defaultPublicEntrypointFiles = [
  'packages/core/src/index.ts',
  'packages/server/src/index.ts',
];

export const defaultCommandExecutionRoots = ['packages/server/src'];

export const defaultCommandExecutionSinkFiles = ['packages/server/src/command.ts'];

export const defaultRootedFileServeSinkFiles = ['packages/server/src/file.ts'];

export const defaultDynamicCodeExecutionSinkFiles = [];

export const defaultDeserializationRoots = ['packages/server/src'];

export const defaultLogChannelRoots = ['packages/server/src'];

export const defaultLogChannelNeutralizerFiles = ['packages/server/src/logging.ts'];

export const defaultResponseFragmentApplyPath = 'packages/browser/src/response-fragment-apply.ts';

export const defaultSqlGuardDowngradeRoots = [
  'packages/core/src',
  'packages/drizzle/src',
  'packages/server/src',
  'packages/cli/src',
];

export const defaultSqlSafetyInvariantFiles = [
  'packages/core/src/diagnostics.ts',
  'packages/core/src/internal/sql-safety.ts',
  'packages/drizzle/src/static.ts',
  'packages/cli/src/commands/compile.ts',
  'packages/cli/src/graph-output.ts',
  'packages/server/src/sql-safe-handle.ts',
];

const responseFragmentHtmlSinkKind = 'browser:response-fragment-html';
const defaultSqlBlessedBrandRoots = [
  'packages/core/src',
  'packages/drizzle/src',
  'packages/server/src',
];
const defaultSqlBlessedBrandConstructorFiles = ['packages/core/src/internal/sql-safety.ts'];
const defaultSqlBlessedBrandStampFiles = [
  'packages/core/src/internal/sql-safety.ts',
  'packages/drizzle/src/runtime.ts',
];
const sqlBlessedBrandTypeNames = new Set([
  'KovoParameterizedSql',
  'KovoSqlIdentifier',
  'KovoSqlKeyword',
  'KovoStaticSql',
  'KovoTrustedSql',
  'ParameterizedSql',
  'SqlIdentifier',
  'SqlKeyword',
  'StaticSqlText',
  'TrustedSql',
]);
const sqlBlessedBrandStampNames = new Set([
  'stampParameterizedSql',
  'stampRawSqlChunk',
  'stampSqlIdentifier',
  'stampSqlKeyword',
  'stampStaticSql',
  'stampTrustedSql',
]);

const allowedSinkPolicyExports = new Set([
  'Blessed',
  'FRAMEWORK_BLESSED_SINK_KINDS',
  'FrameworkBlessedSinkKind',
  'RuntimeSinkAction',
  'RuntimeSinkDecision',
  'RuntimeSinkFamily',
  'RuntimeSinkSecurityEvent',
  'RuntimeSinkSecurityEventHandler',
  'SAFE_URL_SCHEMES',
  'SRCSET_ATTRIBUTE_NAMES',
  'RAW_HTML_SINK_NAMES',
  'URL_ATTRIBUTE_NAMES',
  'blessSink',
  'decideRuntimeAttributeWrite',
  'drainRuntimeSinkSecurityEvent',
  'hasUnsafeCssText',
  'hasUnsafeCssUrl',
  'isBlessedSink',
  'isCssTextAttributeName',
  'isEventHandlerAttributeName',
  'isRawHtmlSinkName',
  'isSrcdocAttributeName',
  'isSrcsetAttributeName',
  'runtimeSinkFamilyForAttribute',
  'sanitizeRuntimeSrcset',
  'setRuntimeSinkSecurityEventHandler',
]);

const forbiddenPublicEscapeNames = new Set([
  'assertBlessed',
  'assertBlessedSink',
  'bless',
  'blessSink',
  'trust',
  'trustSink',
  'trusted',
  'isBlessedSink',
]);

export function checkSinkPolicyGate(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const sinkPolicyPath = options.sinkPolicyPath ?? defaultSinkPolicyPath;
  const blessedSinkFiles = options.blessedSinkFiles ?? defaultBlessedSinkFiles;
  const commandExecutionRoots = options.commandExecutionRoots ?? defaultCommandExecutionRoots;
  const commandExecutionSinkFiles =
    options.commandExecutionSinkFiles ?? defaultCommandExecutionSinkFiles;
  const dynamicCodeExecutionSinkFiles =
    options.dynamicCodeExecutionSinkFiles ?? defaultDynamicCodeExecutionSinkFiles;
  const deserializationFiles =
    options.deserializationFiles ?? collectSourceFiles(root, defaultDeserializationRoots);
  const logChannelRoots = options.logChannelRoots ?? defaultLogChannelRoots;
  const logChannelNeutralizerFiles =
    options.logChannelNeutralizerFiles ?? defaultLogChannelNeutralizerFiles;
  const responseFragmentApplyPath = Object.hasOwn(options, 'responseFragmentApplyPath')
    ? options.responseFragmentApplyPath
    : defaultResponseFragmentApplyPath;
  const sqlGuardDowngradeFiles =
    options.sqlGuardDowngradeFiles ?? collectSourceFiles(root, defaultSqlGuardDowngradeRoots);
  const sqlSafetyInvariantFiles = options.sqlSafetyInvariantFiles ?? defaultSqlSafetyInvariantFiles;
  const sqlBlessedBrandFiles =
    options.sqlBlessedBrandFiles ?? collectSourceFiles(root, defaultSqlBlessedBrandRoots);
  const sqlBlessedBrandConstructorFileSet = new Set(
    options.sqlBlessedBrandConstructorFiles ?? defaultSqlBlessedBrandConstructorFiles,
  );
  const sqlBlessedBrandStampFileSet = new Set(
    options.sqlBlessedBrandStampFiles ?? defaultSqlBlessedBrandStampFiles,
  );
  const commandExecutionFiles =
    options.commandExecutionFiles ?? collectSourceFiles(root, commandExecutionRoots);
  const rootedFileServeSinkFiles =
    options.rootedFileServeSinkFiles ?? defaultRootedFileServeSinkFiles;
  const logChannelFiles = options.logChannelFiles ?? collectSourceFiles(root, logChannelRoots);
  const publicEntrypointFiles = options.publicEntrypointFiles ?? defaultPublicEntrypointFiles;
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const exists = options.exists ?? ((relativePath) => existsSync(path.join(root, relativePath)));

  const findings = [];
  const sinkPolicyText = readText(sinkPolicyPath);
  const registeredKinds = extractRegisteredBlessedSinkKinds(sinkPolicyText);

  if (registeredKinds.size === 0) {
    findings.push(`${sinkPolicyPath}: FRAMEWORK_BLESSED_SINK_KINDS registry is missing or empty`);
  }

  if (!registeredKinds.has(responseFragmentHtmlSinkKind)) {
    findings.push(
      `${sinkPolicyPath}: FRAMEWORK_BLESSED_SINK_KINDS must register ${JSON.stringify(
        responseFragmentHtmlSinkKind,
      )} for the browser response-fragment raw HTML sink`,
    );
  }

  if (/\bSymbol\.for\s*\(/.test(sinkPolicyText)) {
    findings.push(
      `${sinkPolicyPath}: shared Blessed<Sink> witness substrate must not use Symbol.for()`,
    );
  }

  for (const exportedName of exportedNames(sinkPolicyText)) {
    if (!allowedSinkPolicyExports.has(exportedName)) {
      findings.push(
        `${sinkPolicyPath}: unexpected sink-policy export ${exportedName}; avoid generic trust/bless escape hatches`,
      );
    }
  }

  for (const filePath of blessedSinkFiles) {
    if (!exists(filePath)) {
      findings.push(`${filePath}: blessed sink gate input is missing`);
      continue;
    }

    const text = readText(filePath);
    for (const sinkKind of blessedSinkKindsReferencedByFile(text)) {
      if (!registeredKinds.has(sinkKind)) {
        findings.push(
          `${filePath}: blessed sink kind ${JSON.stringify(
            sinkKind,
          )} is used but not declared in FRAMEWORK_BLESSED_SINK_KINDS`,
        );
      }
    }
  }

  for (const filePath of sqlBlessedBrandFiles) {
    if (!exists(filePath)) {
      findings.push(`${filePath}: SQL blessed-brand laundering gate input is missing`);
      continue;
    }
    findings.push(
      ...sqlBlessedBrandLaunderingFindings(filePath, readText(filePath), {
        allowedConstructorFile: sqlBlessedBrandConstructorFileSet.has(filePath),
      }),
    );
    findings.push(
      ...sqlBlessedBrandStampFindings(filePath, readText(filePath), {
        allowedStampFile: sqlBlessedBrandStampFileSet.has(filePath),
      }),
    );
  }

  for (const filePath of sqlGuardDowngradeFiles) {
    if (!exists(filePath)) {
      findings.push(`${filePath}: SQL guard downgrade gate input is missing`);
      continue;
    }
    findings.push(...sqlGuardDowngradeFindings(filePath, readText(filePath)));
  }

  for (const filePath of sqlSafetyInvariantFiles) {
    if (!exists(filePath)) {
      findings.push(`${filePath}: SQL safety invariant gate input is missing`);
      continue;
    }
    findings.push(...sqlSafetyInvariantFindings(filePath, readText(filePath)));
  }

  const commandExecutionSinkFileSet = new Set(commandExecutionSinkFiles);
  const dynamicCodeExecutionSinkFileSet = new Set(dynamicCodeExecutionSinkFiles);
  const rootedFileServeSinkFileSet = new Set(rootedFileServeSinkFiles);
  const logChannelNeutralizerFileSet = new Set(logChannelNeutralizerFiles);
  for (const filePath of commandExecutionFiles) {
    if (!exists(filePath)) {
      findings.push(`${filePath}: command execution gate input is missing`);
      continue;
    }
    const text = readText(filePath);
    findings.push(
      ...commandExecutionSinkFindings(filePath, text, {
        allowedExecutionSink: commandExecutionSinkFileSet.has(filePath),
      }),
    );
    findings.push(
      ...dynamicCodeExecutionSinkFindings(filePath, text, {
        allowedExecutionSink: dynamicCodeExecutionSinkFileSet.has(filePath),
      }),
    );
    findings.push(
      ...rootedFileServeRawSinkFindings(filePath, text, {
        allowedFileServeSink: rootedFileServeSinkFileSet.has(filePath),
      }),
    );
    if (deserializationFiles.includes(filePath)) {
      findings.push(...deserializationSinkFindings(filePath, text));
    }
    if (commandExecutionSinkFileSet.has(filePath)) {
      findings.push(...commandPrimitiveInvariantFindings(filePath, text));
    }
    if (rootedFileServeSinkFileSet.has(filePath)) {
      findings.push(...rootedFileServeInvariantFindings(filePath, text));
    }
  }

  for (const filePath of rootedFileServeSinkFiles) {
    if (commandExecutionFiles.includes(filePath)) continue;
    if (!exists(filePath)) {
      findings.push(`${filePath}: rooted file-serve gate input is missing`);
      continue;
    }
    findings.push(...rootedFileServeInvariantFindings(filePath, readText(filePath)));
  }

  for (const filePath of deserializationFiles) {
    if (commandExecutionFiles.includes(filePath)) continue;
    if (!exists(filePath)) {
      findings.push(`${filePath}: deserialization gate input is missing`);
      continue;
    }
    findings.push(...deserializationSinkFindings(filePath, readText(filePath)));
  }

  for (const filePath of logChannelFiles) {
    if (!exists(filePath)) {
      findings.push(`${filePath}: log-channel gate input is missing`);
      continue;
    }
    const text = readText(filePath);
    findings.push(
      ...logChannelSinkFindings(filePath, text, {
        allowedNeutralizerFile: logChannelNeutralizerFileSet.has(filePath),
      }),
    );
    if (logChannelNeutralizerFileSet.has(filePath)) {
      findings.push(...logChannelNeutralizerInvariantFindings(filePath, text));
    }
  }

  for (const filePath of publicEntrypointFiles) {
    if (!exists(filePath)) continue;
    const text = readText(filePath);
    for (const exportedName of exportedNames(text)) {
      if (forbiddenPublicEscapeNames.has(exportedName)) {
        findings.push(
          `${filePath}: public export ${exportedName} would create a generic blessed-sink escape hatch`,
        );
      }
    }
    findings.push(...publicSinkPolicyEscapeFindings(filePath, text));
  }

  if (responseFragmentApplyPath) {
    if (!exists(responseFragmentApplyPath)) {
      findings.push(
        `${responseFragmentApplyPath}: response-fragment HTML sink gate input is missing`,
      );
    } else {
      findings.push(
        ...responseFragmentApplyInvariantFindings(
          responseFragmentApplyPath,
          readText(responseFragmentApplyPath),
        ),
      );
    }
  }

  return findings;
}

export function sqlGuardDowngradeFindings(filePath, text) {
  if (!isProductionSourceFile(filePath)) return [];

  const source = stripComments(text);
  const findings = [];
  const addFinding = (reason) => {
    findings.push(
      `${filePath}: SQL safety must remain default-deny; remove SQL guard downgrade path (${reason})`,
    );
  };

  if (/\bKOVO_SQL_GUARD\b/.test(source)) {
    addFinding('KOVO_SQL_GUARD env knob');
  }

  if (
    /\bprocess\s*\.\s*env\s*\.\s*[A-Za-z0-9_]*SQL[A-Za-z0-9_]*(?:GUARD|SAFETY|MODE)[A-Za-z0-9_]*/i.test(
      source,
    )
  ) {
    addFinding('SQL-related process.env guard');
  }

  if (/\bSqlSafetyMode\s*=\s*[^;]*['"](?:warn|off)['"]/.test(source)) {
    addFinding('SqlSafetyMode warn/off union');
  }

  if (/\b(?:sqlGuard|sqlSafetyGuard|sqlSafetyMode)\b\s*[:=]\s*['"](?:warn|off)['"]/i.test(source)) {
    addFinding('sql guard warn/off config');
  }

  return dedupe(findings);
}

export function sqlSafetyInvariantFindings(filePath, text) {
  const source = stripComments(text);
  const findings = [];

  if (filePath.endsWith('packages/core/src/diagnostics.ts')) {
    const kv422Definition = /\bKV422\s*:\s*\{([\s\S]*?)\n\s*\},/.exec(source)?.[1] ?? '';
    if (!/\bseverity\s*:\s*['"]error['"]/.test(kv422Definition)) {
      findings.push(`${filePath}: KV422 SQL-safety diagnostic severity must remain error`);
    }
  }

  if (filePath.endsWith('packages/core/src/internal/sql-safety.ts')) {
    if (!/\bexport\s+type\s+SqlSafetyMode\s*=\s*['"]enforce['"]\s*;/.test(source)) {
      findings.push(`${filePath}: SqlSafetyMode must remain the single enforce mode`);
    }
    if (
      !/\bfunction\s+unsafeSqlResult\s*\([^)]*\)\s*:[^{]+SqlStatementValidationResult\s*\{[\s\S]*?\bok\s*:\s*false\b/.test(
        source,
      )
    ) {
      findings.push(`${filePath}: unsafe SQL validation results must remain fail-closed`);
    }
  }

  if (filePath.endsWith('packages/drizzle/src/static.ts')) {
    if (
      !/\bcode\s*:\s*['"]KV422['"][\s\S]{0,240}\bseverity\s*:\s*diagnosticDefinitions\s*\.\s*KV422\s*\.\s*severity/.test(
        source,
      )
    ) {
      findings.push(`${filePath}: Drizzle static SQL-safety diagnostics must use KV422 severity`);
    }
  }

  if (filePath.endsWith('packages/cli/src/commands/compile.ts')) {
    if (
      !/\bsqlSafetyDiagnosticErrors\s*\([^)]*\)[\s\S]*?\?\?\s*['"]error['"][\s\S]*?===\s*['"]error['"]/.test(
        source,
      )
    ) {
      findings.push(
        `${filePath}: drizzle-static SQL-safety diagnostics must default absent severity to error`,
      );
    }
    if (!/\bsqlSafetyErrors\s*\.\s*length\s*>\s*0[\s\S]{0,500}\bexitCode\s*:\s*1\b/.test(source)) {
      findings.push(`${filePath}: drizzle-static KV422 SQL-safety errors must force exitCode 1`);
    }
  }

  if (filePath.endsWith('packages/cli/src/graph-output.ts')) {
    if (
      !/\bfor\s*\(\s*const\s+diagnostic\s+of\s+sqlSafetyDiagnostics\s*\(\s*graph\s*\)\s*\)[\s\S]{0,200}diagnosticSeverity\s*\(\s*diagnostic\s*\)\s*===\s*['"]error['"]/.test(
        source,
      )
    ) {
      findings.push(`${filePath}: kovo check must fail on error-severity SQL-safety diagnostics`);
    }
    if (
      !/\bconst\s+severity\s*=\s*diagnostic\s*\.\s*severity\s*\?\?\s*definition\?\s*\.\s*severity\s*\?\?\s*['"]error['"]/.test(
        source,
      )
    ) {
      findings.push(
        `${filePath}: SQL-safety finding rendering must default unknown KV422 severity to error`,
      );
    }
  }

  if (filePath.endsWith('packages/server/src/sql-safe-handle.ts')) {
    if (!/\bvalidateManagedSqlStatement\s*\(\s*statement\s*\)/.test(source)) {
      findings.push(`${filePath}: managed DB handle must validate statements through KV422 floor`);
    }
    if (
      !/\bif\s*\(\s*validation\s*\.\s*ok\s*\)\s*return\s*;[\s\S]{0,120}\bthrow\s+new\s+Error\s*\(\s*validation\s*\.\s*message\s*\)/.test(
        source,
      )
    ) {
      findings.push(`${filePath}: managed DB handle must throw on failed SQL validation`);
    }
  }

  return findings;
}

export function responseFragmentApplyInvariantFindings(filePath, text) {
  const source = stripComments(text);
  const findings = [];

  if (/\binsertAdjacentHTML\s*\(/.test(source)) {
    findings.push(
      `${filePath}: response-fragment HTML sink must not use insertAdjacentHTML; parse through the template sanitizer path`,
    );
  }

  const trustedHtmlSinkRoutes = source.match(/\binnerHTML\s*=\s*trustedHtml\s*\(/g) ?? [];
  if (trustedHtmlSinkRoutes.length !== 2) {
    findings.push(
      `${filePath}: response-fragment HTML sink must route exactly two template.innerHTML writes through trustedHtml(); found ${trustedHtmlSinkRoutes.length}`,
    );
  }

  if (!/\bfunction\s+trustedHtml\s*\(\s*h\s*:\s*string\s*\)/.test(source)) {
    findings.push(
      `${filePath}: response-fragment HTML sink must keep the self-contained trustedHtml() shim for inline-loader extraction`,
    );
  }

  if (!/\bcreatePolicy\s*\(\s*['"]kovo['"]\s*,\s*\{\s*createHTML\s*:/.test(source)) {
    findings.push(
      `${filePath}: response-fragment HTML sink must mint TrustedHTML through the kovo policy`,
    );
  }

  if (
    !/\bfor\s*\(\s*const\s+n\s+of\s+t\s*\.\s*content\s*\.\s*children\s*\)\s*g\s*\(\s*n\s*\)\s*;/.test(
      source,
    )
  ) {
    findings.push(
      `${filePath}: append-mode response fragments must sanitize parsed children before DOM insertion`,
    );
  }

  if (!/\bm\s*\(\s*e\s*,\s*g\s*\(\s*n\s*\)\s*\)\s*;/.test(source)) {
    findings.push(
      `${filePath}: replace-mode response fragments must sanitize the parsed morph root before DOM insertion`,
    );
  }

  if (
    !/\^on\[\^:\]\|\^\(srcdoc\|dangerouslysetinnerhtml\|innerhtml\|outerhtml\|inserthtml\|insertadjacenthtml\)\$/.test(
      source,
    )
  ) {
    findings.push(
      `${filePath}: response-fragment sanitizer denylist must keep event, srcdoc, and raw HTML attributes blocked`,
    );
  }

  return findings;
}

export function sqlBlessedBrandLaunderingFindings(filePath, text, options = {}) {
  if (options.allowedConstructorFile === true) return [];

  const source = stripComments(text);
  const findings = [];
  const brandNames = [...sqlBlessedBrandTypeNames].join('|');
  const brandType = String.raw`(?:${brandNames})\b`;
  const anyOrUnknown = String.raw`(?:any|unknown)\b`;
  const sqlBrandAssertionType = String.raw`(?:[^;\n<>]*&\s*)?${brandType}(?:\s*&[^;\n<>]*)?`;
  const brandFieldValue = String.raw`(?:parameterized|static|trusted|identifier|keyword)`;

  // Narrow KV440 floor: catch local TypeScript assertion/satisfies escape hatches that mint a
  // blessed SQL brand without flowing through sql-safety.ts stamp* constructors. This is not the
  // full §3.1 symbol-provenance analyzer; it pins the most direct laundering shapes.
  const patterns = [
    {
      pattern: new RegExp(String.raw`\bas\s+${anyOrUnknown}\s+as\s+${sqlBrandAssertionType}`, 'g'),
      description: 'any/unknown assertion chain',
    },
    {
      pattern: new RegExp(String.raw`\bas\s+${sqlBrandAssertionType}`, 'g'),
      description: 'direct type assertion',
    },
    {
      pattern: new RegExp(String.raw`\bsatisfies\s+${sqlBrandAssertionType}`, 'g'),
      description: 'satisfies assertion',
    },
  ];
  const brandFieldPatterns = [
    {
      pattern: new RegExp(
        String.raw`(?:^|[,{]\s*)(?:['"])?__kovoSqlBrand(?:['"])?\s*:\s*['"](?:parameterized|static|trusted)['"]`,
        'g',
      ),
      description: '__kovoSqlBrand object field',
    },
    {
      pattern: new RegExp(
        String.raw`(?:^|[,{]\s*)(?:['"])?__kovoSqlIdentifierBrand(?:['"])?\s*:\s*['"]identifier['"]`,
        'g',
      ),
      description: '__kovoSqlIdentifierBrand object field',
    },
    {
      pattern: new RegExp(
        String.raw`(?:^|[,{]\s*)(?:['"])?__kovoSqlKeywordBrand(?:['"])?\s*:\s*['"]keyword['"]`,
        'g',
      ),
      description: '__kovoSqlKeywordBrand object field',
    },
    {
      pattern: new RegExp(
        String.raw`\.\s*__kovoSql(?:Identifier|Keyword)?Brand\s*=\s*['"]${brandFieldValue}['"]`,
        'g',
      ),
      description: 'SQL brand property assignment',
    },
    {
      pattern: new RegExp(
        String.raw`\[\s*['"]__kovoSql(?:Identifier|Keyword)?Brand['"]\s*\]\s*=\s*['"]${brandFieldValue}['"]`,
        'g',
      ),
      description: 'SQL brand property assignment',
    },
  ];

  for (const { pattern, description } of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const precedingText = source.slice(Math.max(0, match.index - 32), match.index);
      if (
        description === 'direct type assertion' &&
        /\bas\s+(?:any|unknown)\s*$/.test(precedingText)
      ) {
        continue;
      }
      findings.push(
        `${filePath}: KV440 SQL blessed-brand laundering via ${description}; use sql\`...\`, staticSql\`...\`, sql.identifier(..., { allow }), sql.allow(...), or trustedSql(...) so the runtime witness is minted by the owning constructor`,
      );
    }
  }

  for (const { pattern, description } of brandFieldPatterns) {
    if (pattern.test(source)) {
      findings.push(
        `${filePath}: KV440 SQL blessed-brand laundering via ${description}; use sql\`...\`, staticSql\`...\`, sql.identifier(..., { allow }), sql.allow(...), or trustedSql(...) so the runtime witness is minted by the owning constructor`,
      );
    }
  }

  // Angle-bracket assertions are not valid in TSX, and `<TrustedSql>` can be a JSX tag there.
  // Keep this floor to .ts/.mts/.cts sources and require expression-start punctuation so generic
  // type arguments such as `identity<TrustedSql>(value)` do not look like laundering.
  if (!/\.[cm]?tsx$/.test(filePath)) {
    const angleAssertionPattern = new RegExp(String.raw`<\s*${sqlBrandAssertionType}\s*>`, 'g');
    let match;
    while ((match = angleAssertionPattern.exec(source)) !== null) {
      const precedingText = source.slice(0, match.index);
      if (!canStartTypeScriptAngleAssertion(precedingText)) continue;
      findings.push(
        `${filePath}: KV440 SQL blessed-brand laundering via angle-bracket type assertion; use sql\`...\`, staticSql\`...\`, sql.identifier(..., { allow }), sql.allow(...), or trustedSql(...) so the runtime witness is minted by the owning constructor`,
      );
    }
  }

  return dedupe(findings);
}

export function sqlBlessedBrandStampFindings(filePath, text, options = {}) {
  if (options.allowedStampFile === true) return [];
  if (!isProductionSourceFile(filePath)) return [];

  const source = stripComments(text);
  const findings = [];
  const importedStampLocals = sqlSafetyStampImports(source);

  for (const imported of importedStampLocals.named) {
    findings.push(
      `${filePath}: KV440 SQL blessed-brand constructor ownership drift via ${imported.imported} import; keep SQL stamp helpers confined to core sql-safety.ts and the reviewed Drizzle runtime adapter`,
    );

    const pattern = new RegExp(`\\b${escapeRegExp(imported.local)}\\s*\\(`);
    if (pattern.test(source)) {
      findings.push(
        `${filePath}: KV440 SQL blessed-brand constructor ownership drift via ${imported.local}(); use sql\`...\`, staticSql\`...\`, sql.identifier(..., { allow }), sql.allow(...), or trustedSql(...) instead of minting stamps outside owned constructors`,
      );
    }
  }

  for (const local of importedStampLocals.namespaces) {
    for (const stampName of sqlBlessedBrandStampNames) {
      const pattern = new RegExp(`\\b${escapeRegExp(local)}\\s*\\.\\s*${stampName}\\s*\\(`);
      if (pattern.test(source)) {
        findings.push(
          `${filePath}: KV440 SQL blessed-brand constructor ownership drift via ${local}.${stampName}(); use sql\`...\`, staticSql\`...\`, sql.identifier(..., { allow }), sql.allow(...), or trustedSql(...) instead of minting stamps outside owned constructors`,
        );
      }
    }
  }

  const stampNamePattern = [...sqlBlessedBrandStampNames].map(escapeRegExp).join('|');
  const directExportPattern = new RegExp(
    String.raw`\bexport\s*(?:type\s*)?\{([^}]+)\}\s*from\s*(['"])([^'"]*sql-safety(?:\.js)?)\2`,
    'g',
  );
  let directExport;
  while ((directExport = directExportPattern.exec(source)) !== null) {
    for (const specifier of parseNamedSpecifiers(directExport[1])) {
      if (!sqlBlessedBrandStampNames.has(specifier.imported)) continue;
      findings.push(
        `${filePath}: KV440 SQL blessed-brand constructor ownership drift via ${specifier.imported} re-export; do not expose SQL stamp helpers outside owned constructors`,
      );
    }
  }

  const wildcardExportPattern =
    /\bexport\s+(?:type\s+)?\*\s*(?:as\s+[A-Za-z_$][\w$]*\s*)?from\s*(['"])([^'"]*sql-safety(?:\.js)?)\1/g;
  if (wildcardExportPattern.test(source)) {
    findings.push(
      `${filePath}: KV440 SQL blessed-brand constructor ownership drift via sql-safety wildcard re-export; do not expose SQL stamp helpers outside owned constructors`,
    );
  }

  const directCallPattern = new RegExp(String.raw`(^|[^\w$.])(${stampNamePattern})\s*\(`, 'g');
  let directCall;
  while ((directCall = directCallPattern.exec(source)) !== null) {
    const local = directCall[2];
    if ([...importedStampLocals.named].some((imported) => imported.local === local)) continue;
    findings.push(
      `${filePath}: KV440 SQL blessed-brand constructor ownership drift via ${local}(); use sql\`...\`, staticSql\`...\`, sql.identifier(..., { allow }), sql.allow(...), or trustedSql(...) instead of minting stamps outside owned constructors`,
    );
  }

  return dedupe(findings);
}

function canStartTypeScriptAngleAssertion(precedingText) {
  const trimmed = precedingText.trimEnd();
  if (trimmed === '') return true;
  if (/[=(:,[{?!]$/.test(trimmed)) return true;
  return /\b(?:return|throw|yield)\s*$/.test(trimmed);
}

export function commandExecutionSinkFindings(filePath, text, options = {}) {
  const source = stripComments(text);
  const findings = [];
  const allowedExecutionSink = options.allowedExecutionSink === true;
  const childProcessImports = childProcessImportLocals(source);

  for (const imported of childProcessImports.named) {
    if (imported.imported === 'exec' || imported.imported === 'execSync') {
      findings.push(
        `${filePath}: forbidden child_process.${imported.imported} import; use cmd()/runCommand() so command execution stays shell-free and witnessed`,
      );
      continue;
    }
    if (!allowedExecutionSink && commandExecutionImportNames.has(imported.imported)) {
      findings.push(
        `${filePath}: raw child_process.${imported.imported} import is outside the command primitive; use cmd()/runCommand()`,
      );
    }
  }

  for (const local of childProcessImports.namespaces) {
    for (const name of commandExecutionImportNames) {
      const pattern = new RegExp(`\\b${escapeRegExp(local)}\\s*\\.\\s*${name}\\s*\\(`);
      if (pattern.test(source)) {
        findings.push(
          `${filePath}: raw child_process.${name} call is outside the command primitive; use cmd()/runCommand()`,
        );
      }
    }
  }

  for (const imported of childProcessImports.named) {
    if (!commandExecutionImportNames.has(imported.imported)) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(imported.local)}\\s*\\(`);
    if (
      pattern.test(source) &&
      !allowedExecutionSink &&
      imported.imported !== 'exec' &&
      imported.imported !== 'execSync'
    ) {
      findings.push(
        `${filePath}: raw child_process.${imported.imported} call is outside the command primitive; use cmd()/runCommand()`,
      );
    }
  }

  return dedupe(findings);
}

export function dynamicCodeExecutionSinkFindings(filePath, text, options = {}) {
  if (options.allowedExecutionSink === true) return [];

  const source = stripComments(text);
  const findings = [];

  if (/(^|[^\w$.])eval\s*\(/.test(source)) {
    findings.push(
      `${filePath}: forbidden dynamic code execution sink eval(); server source must not execute generated code`,
    );
  }

  if (/\bnew\s+Function\s*\(/.test(source)) {
    findings.push(
      `${filePath}: forbidden dynamic code execution sink new Function(); server source must not execute generated code`,
    );
  }

  const sourceWithoutNewFunction = source.replace(/\bnew\s+Function\s*\(/g, '');
  if (/(^|[^\w$.])Function\s*\(/.test(sourceWithoutNewFunction)) {
    findings.push(
      `${filePath}: forbidden dynamic code execution sink Function(); server source must not execute generated code`,
    );
  }

  if (vmModuleImportPattern().test(source)) {
    findings.push(
      `${filePath}: forbidden dynamic code execution sink node:vm/vm import or require; server source must not execute generated code`,
    );
  }

  return dedupe(findings);
}

export function rootedFileServeRawSinkFindings(filePath, text, options = {}) {
  if (options.allowedFileServeSink === true) return [];

  const findings = [];
  const source = stripCommentsAndStringContents(text);
  const fsImports = fsImportLocals(text);

  for (const imported of fsImports.named) {
    if (!rootedFileServeRawSinkNames.has(imported.imported)) continue;
    findings.push(
      `${filePath}: KV424 raw filesystem ${imported.imported} import is outside the rooted file-serve primitive; use rootedFiles().serve() so file/path sinks stay rooted and witnessed`,
    );

    const pattern = new RegExp(`\\b${escapeRegExp(imported.local)}\\s*\\(`);
    if (pattern.test(source)) {
      findings.push(
        `${filePath}: KV424 raw filesystem ${imported.imported} call is outside the rooted file-serve primitive; use rootedFiles().serve() so file/path sinks stay rooted and witnessed`,
      );
    }
  }

  for (const local of fsImports.namespaces) {
    for (const sinkName of rootedFileServeRawSinkNames) {
      const pattern = new RegExp(`\\b${escapeRegExp(local)}\\s*\\.\\s*${sinkName}\\s*\\(`);
      if (pattern.test(source)) {
        findings.push(
          `${filePath}: KV424 raw filesystem ${sinkName} call is outside the rooted file-serve primitive; use rootedFiles().serve() so file/path sinks stay rooted and witnessed`,
        );
      }
    }
  }

  return dedupe(findings);
}

export function deserializationSinkFindings(filePath, text) {
  const source = stripComments(text);
  const findings = [];

  for (const call of callArgumentLists(source, /\bJSON\s*\.\s*parse\s*\(/g)) {
    const args = splitTopLevelArguments(call.argumentsText);
    if (args.length >= 2 && args[1].trim() !== '' && args[1].trim() !== 'undefined') {
      findings.push(
        `${filePath}: KV442 unsafe deserialization sink JSON.parse reviver; keep body/wire decode reviver-free and route request shapes through schema validation`,
      );
    }
  }

  const importedDeserializers = deserializationImportLocals(source);
  for (const imported of importedDeserializers.named) {
    findings.push(
      `${filePath}: KV442 unsafe deserialization import ${imported.imported}; avoid unowned deserialize/unserialize APIs and use JSON.parse without reviver plus schema validation`,
    );
    const pattern = new RegExp(`\\b${escapeRegExp(imported.local)}\\s*\\(`);
    if (pattern.test(source)) {
      findings.push(
        `${filePath}: KV442 unsafe deserialization call ${imported.local}(); avoid unowned deserialize/unserialize APIs and use JSON.parse without reviver plus schema validation`,
      );
    }
  }

  for (const local of importedDeserializers.namespaces) {
    for (const name of deserializationImportNames) {
      const pattern = new RegExp(`\\b${escapeRegExp(local)}\\s*\\.\\s*${name}\\s*\\(`);
      if (pattern.test(source)) {
        findings.push(
          `${filePath}: KV442 unsafe deserialization call ${local}.${name}(); avoid unowned deserialize/unserialize APIs and use JSON.parse without reviver plus schema validation`,
        );
      }
    }
  }

  return dedupe(findings);
}

export function logChannelSinkFindings(filePath, text, options = {}) {
  const source = stripComments(text);
  const findings = [];
  const allowedNeutralizerFile = options.allowedNeutralizerFile === true;

  for (const call of consoleLogCalls(source)) {
    if (allowedNeutralizerFile && call.method !== 'log' && call.method !== 'warn') continue;
    if (!containsRequestDerivedLogValue(call.argumentsText)) continue;
    if (containsLogNeutralizer(call.argumentsText)) continue;
    findings.push(
      `${filePath}: raw console.${call.method} of request-derived values is a KV439 log sink; route values through neutralizeLogValue()/formatLogMessage() before logging`,
    );
  }

  return dedupe(findings);
}

export function logChannelNeutralizerInvariantFindings(filePath, text) {
  const source = stripComments(text);
  const findings = [];

  if (
    !/\bexport\s+function\s+neutralizeLogValue\s*\(\s*value\s*:\s*unknown\s*\)\s*:\s*string/.test(
      source,
    )
  ) {
    findings.push(
      `${filePath}: log-channel neutralizer must export neutralizeLogValue(value: unknown): string`,
    );
  }
  if (
    !/\bexport\s+function\s+formatLogMessage\s*\(\s*strings\s*:\s*TemplateStringsArray\s*,\s*\.\.\.\s*values\s*:\s*unknown\[\]\s*\)\s*:\s*string/.test(
      source,
    )
  ) {
    findings.push(
      `${filePath}: log-channel neutralizer must export formatLogMessage() for tagged request log messages`,
    );
  }
  if (!/\\u0000-\\u001f\\u007f-\\u009f/.test(source)) {
    findings.push(
      `${filePath}: log-channel neutralizer must cover ASCII and C1 control characters`,
    );
  }
  if (!/\.replace\s*\(\s*CONTROL_CHARACTER_PATTERN\s*,\s*visibleControlEscape\s*\)/.test(source)) {
    findings.push(
      `${filePath}: neutralizeLogValue() must replace control characters with visible escapes`,
    );
  }

  return findings;
}

export function commandPrimitiveInvariantFindings(filePath, text) {
  const source = stripComments(text);
  const findings = [];

  if (
    !/\bconst\s+COMMAND_EXEC_FILE_SINK\s*(?::[^=]+)?=\s*['"]server:command-exec-file['"]/.test(
      source,
    )
  ) {
    findings.push(
      `${filePath}: command primitive must declare the registered server:command-exec-file sink kind`,
    );
  }
  if (!/\bblessSink\s*(?:<[^>()]*>)?\s*\(\s*COMMAND_EXEC_FILE_SINK\s*,/.test(source)) {
    findings.push(
      `${filePath}: cmd() must mint Command values with the registered command execution witness`,
    );
  }
  if (!/\bisBlessedSink\s*(?:<[^>()]*>)?\s*\(\s*COMMAND_EXEC_FILE_SINK\s*,/.test(source)) {
    findings.push(
      `${filePath}: runCommand() must re-check the registered command execution witness`,
    );
  }
  if (
    !/\bexecFile\s*\(\s*command\s*\.\s*program\s*,\s*\[\s*\.\.\.\s*command\s*\.\s*argv\s*\]\s*,\s*execOptions\s*,/.test(
      source,
    )
  ) {
    findings.push(
      `${filePath}: runCommand() must execute the minted program/argv through execFile with explicit options`,
    );
  }
  if (!/\bshell\s*:\s*false\b/.test(source)) {
    findings.push(`${filePath}: runCommand() execFile options must set shell: false`);
  }

  return findings;
}

export function rootedFileServeInvariantFindings(filePath, text) {
  const source = stripComments(text);
  const findings = [];

  if (!/\bconst\s+ROOTED_FILE_SERVE_SINK\s*(?::[^=]+)?=\s*['"]rooted-file-serve['"]/.test(source)) {
    findings.push(
      `${filePath}: rooted file primitive must declare the registered rooted-file-serve sink kind`,
    );
  }
  if (!/\bconst\s+realRoot\s*=\s*await\s+realpath\s*\(\s*root\s*\)/.test(source)) {
    findings.push(
      `${filePath}: rootedFiles() must normalize the constructor root through realpath() before minting a capability`,
    );
  }
  if (
    !/\bserve\s*:\s*\([^)]*\)\s*=>\s*serveRootedFile\s*\(\s*realRoot\s*,\s*path\s*,\s*options\s*\)/.test(
      source,
    )
  ) {
    findings.push(
      `${filePath}: rootedFiles() must close serve() over the constructor-owned realRoot`,
    );
  }
  if (
    !/\bblessSink\s*(?:<[^>()]*>)?\s*\(\s*ROOTED_FILE_SERVE_SINK\s*,\s*Object\s*\.\s*freeze\s*\(/.test(
      source,
    )
  ) {
    findings.push(
      `${filePath}: rootedFiles() must mint a frozen RootedFiles capability with the registered sink witness`,
    );
  }
  if (!/\bisBlessedSink\s*(?:<[^>()]*>)?\s*\(\s*ROOTED_FILE_SERVE_SINK\s*,/.test(source)) {
    findings.push(
      `${filePath}: isRootedFileServeCapability() must re-check the registered rooted-file-serve witness`,
    );
  }
  if (!/\bconst\s+resolved\s*=\s*await\s+safeRealpath\s*\(\s*candidate\s*\)/.test(source)) {
    findings.push(`${filePath}: rooted file serving must realpath the candidate before opening it`);
  }
  if (!/\bcontainsPath\s*\(\s*realRoot\s*,\s*resolved\s*\)/.test(source)) {
    findings.push(
      `${filePath}: rooted file serving must reject candidate realpaths outside the constructor root`,
    );
  }
  if (
    !/\bconst\s+\[\s*stat\s*,\s*postOpenResolved\s*\]\s*=\s*await\s+Promise\s*\.\s*all\s*\(/.test(
      source,
    )
  ) {
    findings.push(`${filePath}: rooted file serving must re-stat and re-realpath after open`);
  }
  if (!/\bcontainsPath\s*\(\s*realRoot\s*,\s*postOpenResolved\s*\)/.test(source)) {
    findings.push(
      `${filePath}: rooted file serving must reject post-open realpaths outside the constructor root`,
    );
  }

  return findings;
}

export function extractRegisteredBlessedSinkKinds(text) {
  const registry = /\bFRAMEWORK_BLESSED_SINK_KINDS\s*=\s*\[([\s\S]*?)\]\s+as\s+const\b/.exec(
    stripComments(text),
  );
  if (!registry) return new Set();
  return new Set(stringLiterals(registry[1]));
}

export function blessedSinkKindsReferencedByFile(text) {
  const source = stripComments(text);
  const constants = stringLiteralConstants(source);
  const kinds = new Set();

  for (const kind of stringLiteralUnionTypeMembers(source, /\b\w*BlessedSink\w*\b/g)) {
    kinds.add(kind);
  }

  const callPattern =
    /\b(?:blessSink|isBlessedSink)\s*(?:<[^>()]*>)?\s*\(\s*([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")/g;
  let match;
  while ((match = callPattern.exec(source)) !== null) {
    const argument = match[1];
    if (argument.startsWith("'") || argument.startsWith('"')) {
      kinds.add(argument.slice(1, -1));
      continue;
    }
    const constantValue = constants.get(argument);
    if (constantValue !== undefined) kinds.add(constantValue);
  }

  return kinds;
}

export function exportedNames(text) {
  const source = stripComments(text);
  const names = new Set();
  const declarationPattern =
    /\bexport\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|type)\s+([A-Za-z_$][\w$]*)/g;
  let declaration;
  while ((declaration = declarationPattern.exec(source)) !== null) {
    names.add(declaration[1]);
  }

  const namedExportPattern = /\bexport\s*\{([^}]+)\}/g;
  let namedExport;
  while ((namedExport = namedExportPattern.exec(source)) !== null) {
    for (const specifier of namedExport[1].split(',')) {
      const cleaned = specifier.trim();
      if (!cleaned) continue;
      names.add(
        cleaned
          .split(/\s+as\s+/)
          .at(-1)
          .trim(),
      );
    }
  }

  return names;
}

export function publicSinkPolicyEscapeFindings(filePath, text) {
  const source = stripComments(text);
  const findings = [];
  const sinkPolicyLocals = new Map();

  const directExportPattern =
    /\bexport\s*(?:type\s*)?\{([^}]+)\}\s*from\s*(['"])([^'"]*sink-policy(?:\.js)?)\2/g;
  let directExport;
  while ((directExport = directExportPattern.exec(source)) !== null) {
    for (const specifier of parseNamedSpecifiers(directExport[1])) {
      if (
        forbiddenPublicEscapeNames.has(specifier.imported) &&
        specifier.local !== specifier.imported
      ) {
        findings.push(
          `${filePath}: public re-export ${specifier.imported} from internal sink-policy would create a generic blessed-sink escape hatch`,
        );
      }
    }
  }

  const namespaceExportPattern =
    /\bexport\s+(?:type\s+)?\*\s*(?:as\s+[A-Za-z_$][\w$]*\s*)?from\s*(['"])([^'"]*sink-policy(?:\.js)?)\1/g;
  if (namespaceExportPattern.test(source)) {
    findings.push(
      `${filePath}: public wildcard re-export from internal sink-policy would create a generic blessed-sink escape hatch`,
    );
  }

  const importPattern =
    /\bimport\s+(?:type\s+)?\{([^}]+)\}\s*from\s*(['"])([^'"]*sink-policy(?:\.js)?)\2/g;
  let imported;
  while ((imported = importPattern.exec(source)) !== null) {
    for (const specifier of parseNamedSpecifiers(imported[1])) {
      if (forbiddenPublicEscapeNames.has(specifier.imported)) {
        sinkPolicyLocals.set(specifier.local, specifier.imported);
      }
    }
  }

  const namedExportPattern = /\bexport\s*\{([^}]+)\}/g;
  let namedExport;
  while ((namedExport = namedExportPattern.exec(source)) !== null) {
    for (const specifier of parseNamedSpecifiers(namedExport[1])) {
      const sinkPolicyName = sinkPolicyLocals.get(specifier.imported);
      if (sinkPolicyName !== undefined) {
        findings.push(
          `${filePath}: public export ${specifier.local} aliases internal sink-policy ${sinkPolicyName} and would create a generic blessed-sink escape hatch`,
        );
      }
    }
  }

  return findings;
}

function stringLiteralConstants(text) {
  const constants = new Map();
  const pattern = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*(['"])(.*?)\2/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    constants.set(match[1], match[3]);
  }
  return constants;
}

function parseNamedSpecifiers(text) {
  return text
    .split(',')
    .map((specifier) => {
      const cleaned = specifier.trim();
      if (!cleaned) return undefined;
      const [imported, local = imported] = cleaned.split(/\s+as\s+/);
      return {
        imported: imported.trim(),
        local: local.trim(),
      };
    })
    .filter((specifier) => specifier !== undefined);
}

const commandExecutionImportNames = new Set([
  'exec',
  'execFile',
  'execSync',
  'fork',
  'spawn',
  'spawnSync',
]);
const deserializationImportNames = new Set(['deserialize', 'unserialize']);
const rootedFileServeRawSinkNames = new Set([
  'createReadStream',
  'createWriteStream',
  'open',
  'openSync',
]);

function consoleLogCalls(text) {
  const calls = [];
  const pattern = /\bconsole\s*\.\s*(log|warn|error|info|debug|trace)\s*\(([\s\S]*?)\)\s*;?/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    calls.push({ method: match[1], argumentsText: match[2] });
  }
  return calls;
}

function containsRequestDerivedLogValue(text) {
  const requestIdentifiers = String.raw`(?:req|request)`;
  const contextRequestProperties = String.raw`(?:ctx|context)\s*\.\s*(?:request|req)`;
  const requestRoot = String.raw`(?:${requestIdentifiers}|${contextRequestProperties})`;
  return new RegExp(
    [
      String.raw`\$\{[^}]*\b${requestRoot}\b[^}]*\}`,
      String.raw`\b${requestRoot}\s*\.`,
      String.raw`\b${requestRoot}\s*\[`,
    ].join('|'),
  ).test(text);
}

function containsLogNeutralizer(text) {
  return (
    /\bneutralizeLogValue\s*(?:<[^>()]*>)?\s*\(/.test(text) ||
    /\bformatLogMessage\s*(?:<[^>()]*>)?\s*(?:\(|`)/.test(text)
  );
}

function vmModuleImportPattern() {
  const vmModule = String.raw`(?:node:)?vm`;
  return new RegExp(
    [
      String.raw`\bimport\s+(?:type\s+)?(?:[^'";]+?\s+from\s*)?(['"])${vmModule}\1`,
      String.raw`\bimport\s*\(\s*(['"])${vmModule}\2\s*\)`,
      String.raw`\brequire\s*\(\s*(['"])${vmModule}\3\s*\)`,
    ].join('|'),
    'g',
  );
}

function childProcessImportLocals(text) {
  const named = [];
  const namespaces = new Set();
  const childProcessModule = String.raw`(?:node:)?child_process`;

  const namedImportPattern = new RegExp(
    String.raw`\bimport\s*\{([^}]+)\}\s*from\s*(['"])${childProcessModule}\2`,
    'g',
  );
  let namedImport;
  while ((namedImport = namedImportPattern.exec(text)) !== null) {
    named.push(...parseNamedSpecifiers(namedImport[1]));
  }

  const namespaceImportPattern = new RegExp(
    String.raw`\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*(['"])${childProcessModule}\2`,
    'g',
  );
  let namespaceImport;
  while ((namespaceImport = namespaceImportPattern.exec(text)) !== null) {
    namespaces.add(namespaceImport[1]);
  }

  const destructuredRequirePattern = new RegExp(
    String.raw`\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\s*\(\s*(['"])${childProcessModule}\2\s*\)`,
    'g',
  );
  let destructuredRequire;
  while ((destructuredRequire = destructuredRequirePattern.exec(text)) !== null) {
    named.push(...parseObjectBindingSpecifiers(destructuredRequire[1]));
  }

  const namespaceRequirePattern = new RegExp(
    String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*(['"])${childProcessModule}\2\s*\)`,
    'g',
  );
  let namespaceRequire;
  while ((namespaceRequire = namespaceRequirePattern.exec(text)) !== null) {
    namespaces.add(namespaceRequire[1]);
  }

  return { named, namespaces };
}

function fsImportLocals(text) {
  const named = [];
  const namespaces = new Set();
  const fsModule = String.raw`(?:node:)?fs(?:\/promises)?`;

  const namedImportPattern = new RegExp(
    String.raw`\bimport\s*\{([^}]+)\}\s*from\s*(['"])${fsModule}\2`,
    'g',
  );
  let namedImport;
  while ((namedImport = namedImportPattern.exec(text)) !== null) {
    if (isInsideStringOrComment(text, namedImport.index)) continue;
    named.push(...parseNamedSpecifiers(namedImport[1]));
  }

  const namespaceImportPattern = new RegExp(
    String.raw`\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*(['"])${fsModule}\2`,
    'g',
  );
  let namespaceImport;
  while ((namespaceImport = namespaceImportPattern.exec(text)) !== null) {
    if (isInsideStringOrComment(text, namespaceImport.index)) continue;
    namespaces.add(namespaceImport[1]);
  }

  const destructuredRequirePattern = new RegExp(
    String.raw`\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\s*\(\s*(['"])${fsModule}\2\s*\)`,
    'g',
  );
  let destructuredRequire;
  while ((destructuredRequire = destructuredRequirePattern.exec(text)) !== null) {
    if (isInsideStringOrComment(text, destructuredRequire.index)) continue;
    named.push(...parseObjectBindingSpecifiers(destructuredRequire[1]));
  }

  const namespaceRequirePattern = new RegExp(
    String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*(['"])${fsModule}\2\s*\)`,
    'g',
  );
  let namespaceRequire;
  while ((namespaceRequire = namespaceRequirePattern.exec(text)) !== null) {
    if (isInsideStringOrComment(text, namespaceRequire.index)) continue;
    namespaces.add(namespaceRequire[1]);
  }

  return { named, namespaces };
}

function deserializationImportLocals(text) {
  const named = [];
  const namespaces = new Set();

  const namedImportPattern = /\bimport\s*\{([^}]+)\}\s*from\s*(['"])([^'"]+)\2/g;
  let namedImport;
  while ((namedImport = namedImportPattern.exec(text)) !== null) {
    for (const specifier of parseNamedSpecifiers(namedImport[1])) {
      if (deserializationImportNames.has(specifier.imported)) named.push(specifier);
    }
  }

  const namespaceImportPattern =
    /\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*(['"])([^'"]+)\2/g;
  let namespaceImport;
  while ((namespaceImport = namespaceImportPattern.exec(text)) !== null) {
    if (moduleNameSuggestsDeserialization(namespaceImport[3])) namespaces.add(namespaceImport[1]);
  }

  const destructuredRequirePattern =
    /\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\s*\(\s*(['"])([^'"]+)\2\s*\)/g;
  let destructuredRequire;
  while ((destructuredRequire = destructuredRequirePattern.exec(text)) !== null) {
    for (const specifier of parseObjectBindingSpecifiers(destructuredRequire[1])) {
      if (deserializationImportNames.has(specifier.imported)) named.push(specifier);
    }
  }

  const namespaceRequirePattern =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*(['"])([^'"]+)\2\s*\)/g;
  let namespaceRequire;
  while ((namespaceRequire = namespaceRequirePattern.exec(text)) !== null) {
    if (moduleNameSuggestsDeserialization(namespaceRequire[3])) namespaces.add(namespaceRequire[1]);
  }

  const destructuredDynamicImportPattern =
    /\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*(?:await\s+)?import\s*\(\s*(['"])([^'"]+)\2\s*\)/g;
  let destructuredDynamicImport;
  while ((destructuredDynamicImport = destructuredDynamicImportPattern.exec(text)) !== null) {
    if (!moduleNameSuggestsDeserialization(destructuredDynamicImport[3])) continue;
    for (const specifier of parseObjectBindingSpecifiers(destructuredDynamicImport[1])) {
      if (deserializationImportNames.has(specifier.imported)) named.push(specifier);
    }
  }

  const namespaceDynamicImportPattern =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?import\s*\(\s*(['"])([^'"]+)\2\s*\)/g;
  let namespaceDynamicImport;
  while ((namespaceDynamicImport = namespaceDynamicImportPattern.exec(text)) !== null) {
    if (moduleNameSuggestsDeserialization(namespaceDynamicImport[3])) {
      namespaces.add(namespaceDynamicImport[1]);
    }
  }

  return { named, namespaces };
}

function sqlSafetyStampImports(text) {
  const named = [];
  const namespaces = new Set();
  const sqlSafetyModule = String.raw`[^'"]*sql-safety(?:\.js)?`;

  const namedImportPattern = new RegExp(
    String.raw`\bimport\s*\{([^}]+)\}\s*from\s*(['"])${sqlSafetyModule}\2`,
    'g',
  );
  let namedImport;
  while ((namedImport = namedImportPattern.exec(text)) !== null) {
    for (const specifier of parseNamedSpecifiers(namedImport[1])) {
      if (sqlBlessedBrandStampNames.has(specifier.imported)) named.push(specifier);
    }
  }

  const namespaceImportPattern = new RegExp(
    String.raw`\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*(['"])${sqlSafetyModule}\2`,
    'g',
  );
  let namespaceImport;
  while ((namespaceImport = namespaceImportPattern.exec(text)) !== null) {
    namespaces.add(namespaceImport[1]);
  }

  const destructuredRequirePattern = new RegExp(
    String.raw`\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\s*\(\s*(['"])${sqlSafetyModule}\2\s*\)`,
    'g',
  );
  let destructuredRequire;
  while ((destructuredRequire = destructuredRequirePattern.exec(text)) !== null) {
    for (const specifier of parseObjectBindingSpecifiers(destructuredRequire[1])) {
      if (sqlBlessedBrandStampNames.has(specifier.imported)) named.push(specifier);
    }
  }

  const namespaceRequirePattern = new RegExp(
    String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*(['"])${sqlSafetyModule}\2\s*\)`,
    'g',
  );
  let namespaceRequire;
  while ((namespaceRequire = namespaceRequirePattern.exec(text)) !== null) {
    namespaces.add(namespaceRequire[1]);
  }

  return { named, namespaces };
}

function moduleNameSuggestsDeserialization(moduleName) {
  return /(?:^|[/@_-])(?:node:v8|v8|serialize|serializer|deserialize|deserializer|unserialize)(?:$|[/._-])/i.test(
    moduleName,
  );
}

function callArgumentLists(text, callPattern) {
  const calls = [];
  let match;
  while ((match = callPattern.exec(text)) !== null) {
    const openParenIndex = text.indexOf('(', match.index);
    const closeParenIndex = matchingCloseParen(text, openParenIndex);
    if (closeParenIndex < 0) continue;
    calls.push({ argumentsText: text.slice(openParenIndex + 1, closeParenIndex) });
    callPattern.lastIndex = closeParenIndex + 1;
  }
  return calls;
}

function matchingCloseParen(text, openParenIndex) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = openParenIndex; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevelArguments(text) {
  const args = [];
  let start = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') parenDepth += 1;
    else if (char === ')') parenDepth -= 1;
    else if (char === '[') bracketDepth += 1;
    else if (char === ']') bracketDepth -= 1;
    else if (char === '{') braceDepth += 1;
    else if (char === '}') braceDepth -= 1;
    else if (char === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      args.push(text.slice(start, index));
      start = index + 1;
    }
  }
  args.push(text.slice(start));
  return args;
}

function parseObjectBindingSpecifiers(text) {
  return text
    .split(',')
    .map((specifier) => {
      const cleaned = specifier.trim();
      if (!cleaned) return undefined;
      const [imported, local = imported] = cleaned.split(/\s*:\s*/);
      return {
        imported: imported.trim(),
        local: local.trim(),
      };
    })
    .filter((specifier) => specifier !== undefined);
}

function collectSourceFiles(root, roots) {
  const files = [];
  for (const relativeRoot of roots) {
    const absoluteRoot = path.join(root, relativeRoot);
    if (!existsSync(absoluteRoot)) continue;
    collectSourceFilesInto(root, absoluteRoot, files);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function collectSourceFilesInto(root, absolutePath, files) {
  for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
    const absoluteEntryPath = path.join(absolutePath, entry.name);
    if (entry.isDirectory()) {
      collectSourceFilesInto(root, absoluteEntryPath, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const relativePath = path.relative(root, absoluteEntryPath).split(path.sep).join('/');
    if (!/\.[cm]?tsx?$/.test(relativePath)) continue;
    if (relativePath.endsWith('.d.ts')) continue;
    if (/\.(?:test|spec)\.[cm]?tsx?$/.test(relativePath)) continue;
    files.push(relativePath);
  }
}

function isProductionSourceFile(filePath) {
  if (!/\.[cm]?tsx?$/.test(filePath)) return false;
  if (filePath.endsWith('.d.ts')) return false;
  if (/\.(?:test|spec)\.[cm]?tsx?$/.test(filePath)) return false;
  return /^(?:packages\/(?:core|drizzle|server|cli)\/src)\//.test(filePath);
}

function dedupe(values) {
  return [...new Set(values)];
}

function stringLiteralUnionTypeMembers(text, namePattern) {
  const kinds = [];
  const typePattern = /\btype\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*['"][^;]+)\s*;/g;
  let match;
  while ((match = typePattern.exec(text)) !== null) {
    if (!namePattern.test(match[1])) {
      namePattern.lastIndex = 0;
      continue;
    }
    namePattern.lastIndex = 0;
    kinds.push(...stringLiterals(match[2]));
  }
  return kinds;
}

function stringLiterals(text) {
  const values = [];
  const pattern = /(['"])(.*?)\1/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    values.push(match[2]);
  }
  return values;
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function stripCommentsAndStringContents(text) {
  let output = '';
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (lineComment) {
      if (char === '\n') {
        lineComment = false;
        output += '\n';
      } else {
        output += ' ';
      }
      continue;
    }

    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        output += '  ';
        index += 1;
      } else {
        output += char === '\n' ? '\n' : ' ';
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      output += char === '\n' ? '\n' : ' ';
      continue;
    }

    if (char === '/' && next === '/') {
      lineComment = true;
      output += '  ';
      index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      blockComment = true;
      output += '  ';
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      output += ' ';
      continue;
    }

    output += char;
  }

  return output;
}

function isInsideStringOrComment(text, offset) {
  return stripCommentsAndStringContents(text).slice(offset, offset + 1) === ' ';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = checkSinkPolicyGate();
  if (findings.length > 0) {
    console.error(`Sink policy gate failed with ${findings.length} finding(s):`);
    for (const finding of findings) console.error(`- ${finding}`);
    process.exit(1);
  }
  console.log('Sink policy gate passed.');
}
