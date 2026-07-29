import { Node, SyntaxKind, type SourceFile } from 'ts-morph';

/**
 * Keep this finite vocabulary structurally identical to the compiler-owned app resolver without
 * adding a compiler -> Drizzle package dependency. The compiler remains the only producer with
 * authority to prove the app receiver; this module only authenticates that a supplied fact still
 * names the exact source snapshot and property-access node being analyzed (SPEC §5.2).
 */
export const compilerOwnedAppContractMemberNames = [
  'endpoint',
  'layout',
  'mutation',
  'query',
  'route',
  'task',
  'all',
  'assemble',
  'authenticated',
  'integrateMutation',
  'owns',
  'publicAccess',
  'rateLimit',
  'role',
  'verifiedAccess',
] as const;

/** @internal */
export type CompilerOwnedAppContractMemberName =
  (typeof compilerOwnedAppContractMemberNames)[number];

/**
 * Exact source-bound carrier emitted by the compiler's app-contract project.
 *
 * This is intentionally a structural mirror rather than an import from `@kovojs/compiler`: the
 * static Drizzle analyzer must remain usable without making the compiler a runtime dependency.
 *
 * @internal
 */
export interface CompilerOwnedAppContractStaticFact {
  readonly end: number;
  readonly fileName: string;
  readonly memberName: CompilerOwnedAppContractMemberName;
  readonly ownerKey: string;
  readonly source: string;
  readonly start: number;
}

interface RegisteredAppContractStaticFact {
  readonly memberName: CompilerOwnedAppContractMemberName;
  readonly ownerKey: string;
}

interface ValidatedAppContractStaticFact extends RegisteredAppContractStaticFact {
  readonly end: number;
  readonly fileName: string;
  readonly sourceFile: SourceFile;
  readonly start: number;
}

const MAX_APP_CONTRACT_STATIC_FACTS = 16_384;
const MAX_APP_CONTRACT_PROPERTY_ACCESS_SPAN = 4_096;
const MAX_APP_CONTRACT_OWNER_KEY_LENGTH = 4_096;
const appContractStaticFactsBySourceFile = new WeakMap<
  SourceFile,
  ReadonlyMap<string, RegisteredAppContractStaticFact>
>();
const appContractMemberNameSet: ReadonlySet<string> = new Set(compilerOwnedAppContractMemberNames);

/**
 * Authenticate and register compiler-owned facts against the exact ts-morph project snapshot.
 *
 * Filename matching is deliberately exact. In particular, this bridge never normalizes, resolves,
 * or suffix-matches a fact filename: the caller that assembled the compiler and Drizzle projects
 * must bind both to the same filename spelling. This keeps similarly named files from acquiring
 * one another's declaration authority (SPEC §5.2/§10.3).
 *
 * @internal
 */
export function registerCompilerOwnedAppContractStaticFacts(
  rawFacts: readonly CompilerOwnedAppContractStaticFact[] | undefined,
  files: readonly { readonly fileName: string; readonly source: string }[],
  sourceFiles: readonly SourceFile[],
): () => void {
  if (rawFacts === undefined) return () => undefined;
  if (!Array.isArray(rawFacts)) {
    throw appContractStaticFactError('facts must be an array');
  }
  if (rawFacts.length > MAX_APP_CONTRACT_STATIC_FACTS) {
    throw appContractStaticFactError(`fact count exceeds ${MAX_APP_CONTRACT_STATIC_FACTS}`);
  }
  if (files.length !== sourceFiles.length) {
    throw appContractStaticFactError('project source snapshots are not one-to-one');
  }

  const filesByExactName = new Map<
    string,
    { readonly file: (typeof files)[number]; readonly sourceFile: SourceFile }
  >();
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    if (filesByExactName.has(file.fileName)) {
      throw appContractStaticFactError(`project contains duplicate filename ${file.fileName}`);
    }
    filesByExactName.set(file.fileName, { file, sourceFile: sourceFiles[index]! });
  }

  const facts = rawFacts.map((rawFact, index) =>
    validateStaticFactShape(rawFact, index, filesByExactName),
  );
  const ordered = [...facts].sort(
    (left, right) =>
      left.fileName.localeCompare(right.fileName) ||
      left.start - right.start ||
      left.end - right.end,
  );
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const fact = ordered[index]!;
    if (previous.fileName !== fact.fileName) continue;
    if (previous.start === fact.start && previous.end === fact.end) {
      throw appContractStaticFactError(
        `duplicate facts for ${fact.fileName}:${fact.start}-${fact.end}`,
      );
    }
    if (previous.end > fact.start) {
      throw appContractStaticFactError(
        `overlapping facts for ${fact.fileName}:${previous.start}-${previous.end} and ${fact.start}-${fact.end}`,
      );
    }
  }

  const factsBySourceFile = new Map<SourceFile, Map<string, RegisteredAppContractStaticFact>>();
  const propertyAccessesBySourceFile = new Map<SourceFile, ReadonlyMap<string, string>>();
  for (const fact of facts) {
    let propertyAccesses = propertyAccessesBySourceFile.get(fact.sourceFile);
    if (!propertyAccesses) {
      propertyAccesses = new Map(
        fact.sourceFile
          .getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
          .map(
            (candidate) =>
              [
                appContractStaticFactSpanKey(candidate.getStart(), candidate.getEnd()),
                candidate.getName(),
              ] as const,
          ),
      );
      propertyAccessesBySourceFile.set(fact.sourceFile, propertyAccesses);
    }
    if (
      propertyAccesses.get(appContractStaticFactSpanKey(fact.start, fact.end)) !== fact.memberName
    ) {
      throw appContractStaticFactError(
        `span ${fact.fileName}:${fact.start}-${fact.end} does not name the exact .${fact.memberName} property access`,
      );
    }

    const bySpan = factsBySourceFile.get(fact.sourceFile) ?? new Map();
    bySpan.set(appContractStaticFactSpanKey(fact.start, fact.end), {
      memberName: fact.memberName,
      ownerKey: fact.ownerKey,
    });
    factsBySourceFile.set(fact.sourceFile, bySpan);
  }

  for (const [sourceFile, bySpan] of factsBySourceFile) {
    appContractStaticFactsBySourceFile.set(sourceFile, bySpan);
  }
  return () => {
    for (const sourceFile of factsBySourceFile.keys()) {
      appContractStaticFactsBySourceFile.delete(sourceFile);
    }
  };
}

/**
 * Return the compiler-proven app member only for the registered exact property-access node.
 *
 * @internal
 */
export function compilerOwnedAppContractMemberNameForExpression(
  expression: Node,
): CompilerOwnedAppContractMemberName | undefined {
  if (!Node.isPropertyAccessExpression(expression)) return undefined;
  const bySpan = appContractStaticFactsBySourceFile.get(expression.getSourceFile());
  const fact = bySpan?.get(
    appContractStaticFactSpanKey(expression.getStart(), expression.getEnd()),
  );
  return fact?.memberName === expression.getName() ? fact.memberName : undefined;
}

/** @internal */
export function compilerOwnedAppContractMemberEquals(
  expression: Node,
  memberName: string,
): boolean {
  return compilerOwnedAppContractMemberNameForExpression(expression) === memberName;
}

function validateStaticFactShape(
  rawFact: CompilerOwnedAppContractStaticFact,
  index: number,
  filesByExactName: ReadonlyMap<
    string,
    {
      readonly file: { readonly fileName: string; readonly source: string };
      readonly sourceFile: SourceFile;
    }
  >,
): ValidatedAppContractStaticFact {
  if (typeof rawFact !== 'object' || rawFact === null || Array.isArray(rawFact)) {
    throw appContractStaticFactError(`facts[${index}] must be an object`);
  }
  const record = rawFact as unknown as Record<PropertyKey, unknown>;
  const fileName = ownStaticFactValue(record, 'fileName', index);
  const source = ownStaticFactValue(record, 'source', index);
  const start = ownStaticFactValue(record, 'start', index);
  const end = ownStaticFactValue(record, 'end', index);
  const memberName = ownStaticFactValue(record, 'memberName', index);
  const ownerKey = ownStaticFactValue(record, 'ownerKey', index);
  if (
    typeof fileName !== 'string' ||
    typeof source !== 'string' ||
    typeof memberName !== 'string' ||
    typeof ownerKey !== 'string'
  ) {
    throw appContractStaticFactError(`facts[${index}] contains non-string identity fields`);
  }
  if (!appContractMemberNameSet.has(memberName)) {
    throw appContractStaticFactError(`facts[${index}] contains unsupported member ${memberName}`);
  }
  if (ownerKey.trim().length === 0 || ownerKey.length > MAX_APP_CONTRACT_OWNER_KEY_LENGTH) {
    throw appContractStaticFactError(`facts[${index}] contains an invalid owner key`);
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    (start as number) < 0 ||
    (end as number) <= (start as number) ||
    (end as number) > source.length ||
    (end as number) - (start as number) > MAX_APP_CONTRACT_PROPERTY_ACCESS_SPAN
  ) {
    throw appContractStaticFactError(`facts[${index}] contains an invalid or unbounded span`);
  }

  const projectFile = filesByExactName.get(fileName);
  if (!projectFile) {
    throw appContractStaticFactError(
      `facts[${index}] filename ${fileName} is not an exact project filename`,
    );
  }
  if (source !== projectFile.file.source) {
    throw appContractStaticFactError(
      `facts[${index}] contains a stale source snapshot for ${fileName}`,
    );
  }
  return {
    end: end as number,
    fileName,
    memberName: memberName as CompilerOwnedAppContractMemberName,
    ownerKey,
    sourceFile: projectFile.sourceFile,
    start: start as number,
  };
}

function ownStaticFactValue(
  record: Record<PropertyKey, unknown>,
  property: keyof CompilerOwnedAppContractStaticFact,
  index: number,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, property);
  if (!descriptor || !('value' in descriptor)) {
    throw appContractStaticFactError(`facts[${index}].${property} must be own data`);
  }
  return descriptor.value;
}

function appContractStaticFactSpanKey(start: number, end: number): string {
  return `${start}:${end}`;
}

function appContractStaticFactError(detail: string): TypeError {
  return new TypeError(`Kovo compiler app-contract static facts refused: ${detail}.`);
}
