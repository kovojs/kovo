import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import {
  compilerArrayAppend,
  compilerArrayIsArray,
  compilerArrayJoin,
  compilerArrayLength,
  compilerCreateMap,
  compilerFailClosed,
  compilerMapForEach,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerRegExpReplace,
  compilerRegExpTest,
  compilerStringSplit,
  compilerStringStartsWith,
  compilerStringToLowerCase,
} from '../compiler-security-intrinsics.js';
import type { CompilerDiagnostic } from '../diagnostics.js';
import { uniqueSorted } from '../shared.js';
import type { PackageComponentPrefixFact } from '../types.js';

interface RegisteredPackagePrefix {
  declaredPrefix: string;
  packageName: string;
}

interface ValidatedPackagePrefixFact {
  effectivePrefix?: string;
  packageName: string;
  prefix?: string | null;
}

const prefixPattern = /^[a-z][a-z0-9-]*-$/;
const kv234Help = diagnosticDefinitions.KV234.help;
const kv234Message = diagnosticDefinitions.KV234.message;
const kv234Severity = diagnosticDefinitions.KV234.severity;

export function validatePackageComponentPrefixes(
  facts: readonly PackageComponentPrefixFact[] | undefined,
  fileName: string,
): CompilerDiagnostic[] {
  if (!facts) return [];
  const factLength = compilerArrayLength(facts, 'Package component prefix facts');
  if (factLength === 0) return [];

  const diagnostics: CompilerDiagnostic[] = [];
  const byPrefix = compilerCreateMap<string, RegisteredPackagePrefix[]>();

  for (let factIndex = 0; factIndex < factLength; factIndex += 1) {
    const fact = validatedPackagePrefixFact(facts, factIndex);
    const declaredPrefix = fact.prefix;
    if (!declaredPrefix) {
      appendDiagnostic(
        diagnostics,
        packagePrefixDiagnostic(
          fileName,
          `${fact.packageName} is imported as a component package but does not declare package.json kovo.prefix.`,
          [
            'SPEC §6.1.1 requires every imported component package to declare a package prefix.',
            'Fix: add "kovo": { "prefix": "acme-" } to the package manifest, or vendor the source so the component names are app-local.',
          ],
        ),
      );
      continue;
    }

    if (!isValidPrefix(declaredPrefix)) {
      appendDiagnostic(
        diagnostics,
        packagePrefixDiagnostic(
          fileName,
          `${fact.packageName} declares invalid package.json kovo.prefix "${declaredPrefix}".`,
          [
            'SPEC §6.1.1 requires package prefixes to be lowercase ASCII and dash-terminated.',
            'Fix: use a prefix like "acme-" so rendered hosts, kovo-c, scoped CSS, and behavior attributes share one stable vocabulary.',
          ],
        ),
      );
      continue;
    }

    const effectivePrefix = fact.effectivePrefix ?? declaredPrefix;
    if (!isValidPrefix(effectivePrefix)) {
      appendDiagnostic(
        diagnostics,
        packagePrefixDiagnostic(
          fileName,
          `${fact.packageName} has invalid effective package prefix "${effectivePrefix}".`,
          [
            'SPEC §6.1.1 applies app aliases before checking the effective prefix.',
            'Fix: choose a lowercase, dash-terminated alias such as "acme-widgets-".',
          ],
        ),
      );
      continue;
    }

    // SPEC §6.1.1 reserves kovo-* for framework packages and attributes.
    const reservedPrefix = reservedKovoPrefixViolation(fact, declaredPrefix, effectivePrefix);
    if (reservedPrefix) {
      appendDiagnostic(
        diagnostics,
        packagePrefixDiagnostic(
          fileName,
          `${fact.packageName} cannot use reserved kovo-* package prefix "${reservedPrefix}".`,
          [
            'SPEC §6.1.1 reserves the kovo-* prefix family for packages whose manifest name is in the @kovojs/* scope.',
            'SPEC §6.1.1 reserves the kovo-* attribute namespace for framework-owned attributes and future loader/compiler growth.',
            'Fix: choose a non-reserved prefix, or add an explicit app-side alias such as "acme-kovo-".',
          ],
        ),
      );
      continue;
    }

    let registrations = compilerMapGet(byPrefix, effectivePrefix);
    if (!registrations) {
      registrations = [];
      compilerMapSet(byPrefix, effectivePrefix, registrations);
    }
    compilerArrayAppend(
      registrations,
      { declaredPrefix, packageName: fact.packageName },
      'Package prefix registrations',
    );
  }

  compilerMapForEach(byPrefix, (registrations, prefix) => {
    const registrationLength = compilerArrayLength(registrations, 'Package prefix registrations');
    if (registrationLength < 2) return;

    const packageNames: string[] = [];
    for (let index = 0; index < registrationLength; index += 1) {
      const registration = ownRegistration(registrations, index);
      compilerArrayAppend(packageNames, registration.packageName, 'Package prefix package names');
    }
    const packages = uniqueSorted(packageNames);
    if (packages.length < 2) return;

    const aliasRegistration = ownRegistration(registrations, registrationLength > 1 ? 1 : 0);
    const aliasPackage = aliasRegistration.packageName;
    const aliasDeclaredPrefix = aliasRegistration.declaredPrefix;
    appendDiagnostic(
      diagnostics,
      packagePrefixDiagnostic(
        fileName,
        `Effective package prefix "${prefix}" is claimed by ${compilerArrayJoin(packages, ' and ')}.`,
        [
          'SPEC §6.1.1 keeps package prefixes app-wide unique because the effective prefix is emitted into rendered hosts, residual kovo-c values, scoped CSS, and package behavior attributes.',
          `Packages: ${compilerArrayJoin(packages, ', ')}.`,
          `Fix: add an app-side alias so one package has a distinct effective prefix, e.g. { packageName: "${aliasPackage}", prefix: "${aliasDeclaredPrefix}", effectivePrefix: "${aliasExample(prefix, aliasPackage)}" }.`,
        ],
      ),
    );
  });

  return diagnostics;
}

function validatedPackagePrefixFact(
  facts: readonly PackageComponentPrefixFact[],
  index: number,
): ValidatedPackagePrefixFact {
  const raw = compilerOwnDataValue(facts, index, 'Package component prefix facts');
  if (!raw || typeof raw !== 'object' || compilerArrayIsArray(raw)) {
    compilerFailClosed(`Package component prefix facts[${index}] must be an own object.`);
  }
  const packageName = compilerOwnDataValue(raw, 'packageName', `Package prefix fact ${index}`);
  const prefix = compilerOwnDataValue(raw, 'prefix', `Package prefix fact ${index}`);
  const effectivePrefix = compilerOwnDataValue(
    raw,
    'effectivePrefix',
    `Package prefix fact ${index}`,
  );
  if (
    typeof packageName !== 'string' ||
    (prefix !== undefined && prefix !== null && typeof prefix !== 'string') ||
    (effectivePrefix !== undefined && typeof effectivePrefix !== 'string')
  ) {
    compilerFailClosed(`Package component prefix facts[${index}] has invalid fields.`);
  }
  return {
    ...(effectivePrefix === undefined ? {} : { effectivePrefix }),
    packageName,
    ...(prefix === undefined ? {} : { prefix }),
  };
}

function ownRegistration(
  registrations: readonly RegisteredPackagePrefix[],
  index: number,
): RegisteredPackagePrefix {
  const registration = compilerOwnDataValue(
    registrations,
    index,
    'Package prefix registrations',
  ) as RegisteredPackagePrefix | undefined;
  if (!registration) {
    compilerFailClosed(`Package prefix registrations[${index}] must be own data.`);
  }
  return registration;
}

function appendDiagnostic(diagnostics: CompilerDiagnostic[], diagnostic: CompilerDiagnostic): void {
  compilerArrayAppend(diagnostics, diagnostic, 'Package prefix diagnostics');
}

function isValidPrefix(prefix: string): boolean {
  return compilerRegExpTest(prefixPattern, prefix);
}

function reservedKovoPrefixViolation(
  fact: ValidatedPackagePrefixFact,
  declaredPrefix: string,
  effectivePrefix: string,
): string | null {
  if (isKovoPackage(fact.packageName)) return null;
  if (compilerStringStartsWith(declaredPrefix, 'kovo-')) return declaredPrefix;
  if (compilerStringStartsWith(effectivePrefix, 'kovo-')) return effectivePrefix;
  return null;
}

function isKovoPackage(packageName: string): boolean {
  return compilerStringStartsWith(packageName, '@kovojs/');
}

function aliasExample(prefix: string, packageName: string): string {
  const parts = compilerStringSplit(compilerRegExpReplace(/^@/u, packageName, ''), '/');
  const partLength = compilerArrayLength(parts, 'Package name parts');
  let scopeOrName: string | undefined;
  for (let index = 0; index < partLength; index += 1) {
    const part = compilerOwnDataValue(parts, index, 'Package name parts');
    if (typeof part !== 'string')
      compilerFailClosed(`Package name parts[${index}] must be a string.`);
    if (part.length > 0) {
      scopeOrName = compilerStringToLowerCase(compilerRegExpReplace(/[^a-zA-Z0-9-]/gu, part, '-'));
      break;
    }
  }
  return `${scopeOrName ?? 'aliased'}-${prefix}`;
}

function packagePrefixDiagnostic(
  fileName: string,
  detail: string,
  help: readonly string[],
): CompilerDiagnostic {
  const lines: string[] = [];
  if (kv234Help) compilerArrayAppend(lines, kv234Help, 'Package prefix help');
  const helpLength = compilerArrayLength(help, 'Package prefix help input');
  for (let index = 0; index < helpLength; index += 1) {
    const line = compilerOwnDataValue(help, index, 'Package prefix help input');
    if (typeof line !== 'string')
      compilerFailClosed(`Package prefix help input[${index}] invalid.`);
    if (line) compilerArrayAppend(lines, line, 'Package prefix help');
  }
  return {
    code: 'KV234',
    fileName,
    help: compilerArrayJoin(lines, '\n'),
    message: `${kv234Message} ${detail}`,
    severity: kv234Severity,
  };
}
