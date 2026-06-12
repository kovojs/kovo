import { diagnosticDefinitions } from '@jiso/core';

import type { CompilerDiagnostic } from '../diagnostics.js';
import type { PackageComponentPrefixFact } from '../types.js';

interface RegisteredPackagePrefix {
  fact: PackageComponentPrefixFact;
}

const prefixPattern = /^[a-z][a-z0-9-]*-$/;

export function validatePackageComponentPrefixes(
  facts: readonly PackageComponentPrefixFact[] | undefined,
  fileName: string,
): CompilerDiagnostic[] {
  if (!facts || facts.length === 0) return [];

  const diagnostics: CompilerDiagnostic[] = [];
  const byPrefix = new Map<string, RegisteredPackagePrefix[]>();

  for (const fact of facts) {
    const declaredPrefix = fact.prefix;
    if (!declaredPrefix) {
      diagnostics.push(
        packagePrefixDiagnostic(
          fileName,
          `${fact.packageName} is imported as a component package but does not declare package.json jiso.prefix.`,
          [
            'SPEC §6.1.1 requires every imported component package to declare a package prefix.',
            'Fix: add "jiso": { "prefix": "acme-" } to the package manifest, or vendor the source so the component names are app-local.',
          ],
        ),
      );
      continue;
    }

    if (!isValidPrefix(declaredPrefix)) {
      diagnostics.push(
        packagePrefixDiagnostic(
          fileName,
          `${fact.packageName} declares invalid package.json jiso.prefix "${declaredPrefix}".`,
          [
            'SPEC §6.1.1 requires package prefixes to be lowercase ASCII and dash-terminated.',
            'Fix: use a prefix like "acme-" so rendered hosts, fw-c, scoped CSS, and behavior attributes share one stable vocabulary.',
          ],
        ),
      );
      continue;
    }

    const effectivePrefix = fact.effectivePrefix ?? declaredPrefix;
    if (!isValidPrefix(effectivePrefix)) {
      diagnostics.push(
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

    const reservedPrefix = reservedJisoPrefixViolation(fact, declaredPrefix, effectivePrefix);
    if (reservedPrefix) {
      diagnostics.push(
        packagePrefixDiagnostic(
          fileName,
          `${fact.packageName} cannot use reserved jiso-* package prefix "${reservedPrefix}".`,
          [
            'SPEC §6.1.1 reserves the jiso-* prefix family for packages whose manifest name is in the @jiso/* scope.',
            'Fix: choose a non-reserved prefix, or add an explicit app-side alias such as "acme-jiso-".',
          ],
        ),
      );
      continue;
    }

    const frameworkReservedPrefix = reservedFrameworkPrefixViolation(
      declaredPrefix,
      effectivePrefix,
    );
    if (frameworkReservedPrefix) {
      diagnostics.push(
        packagePrefixDiagnostic(
          fileName,
          `${fact.packageName} cannot use reserved fw-* package prefix "${frameworkReservedPrefix}".`,
          [
            'SPEC §6.1.1 reserves the fw-* attribute namespace for framework-owned attributes and future loader/compiler growth.',
            'Fix: choose a package-owned prefix such as "acme-" for package behavior attributes.',
          ],
        ),
      );
      continue;
    }

    byPrefix.set(effectivePrefix, [...(byPrefix.get(effectivePrefix) ?? []), { fact }]);
  }

  for (const [prefix, registrations] of byPrefix) {
    if (registrations.length < 2) continue;

    const packages = [
      ...new Set(registrations.map((registration) => registration.fact.packageName)),
    ].sort((left, right) => left.localeCompare(right));
    if (packages.length < 2) continue;

    const aliasRegistration = registrations[1] ?? registrations[0];
    const aliasPackage = aliasRegistration?.fact.packageName ?? packages[0] ?? 'package';
    const aliasDeclaredPrefix = aliasRegistration?.fact.prefix ?? prefix;
    diagnostics.push(
      packagePrefixDiagnostic(
        fileName,
        `Effective package prefix "${prefix}" is claimed by ${packages.join(' and ')}.`,
        [
          'SPEC §6.1.1 keeps package prefixes app-wide unique because the effective prefix is emitted into rendered hosts, residual fw-c values, scoped CSS, and package behavior attributes.',
          `Packages: ${packages.join(', ')}.`,
          `Fix: add an app-side alias so one package has a distinct effective prefix, e.g. { packageName: "${aliasPackage}", prefix: "${aliasDeclaredPrefix}", effectivePrefix: "${aliasExample(prefix, aliasPackage)}" }.`,
        ],
      ),
    );
  }

  return diagnostics;
}

function isValidPrefix(prefix: string): boolean {
  return prefixPattern.test(prefix);
}

function reservedJisoPrefixViolation(
  fact: PackageComponentPrefixFact,
  declaredPrefix: string,
  effectivePrefix: string,
): string | null {
  if (isJisoPackage(fact.packageName)) return null;
  if (declaredPrefix.startsWith('jiso-')) return declaredPrefix;
  if (effectivePrefix.startsWith('jiso-')) return effectivePrefix;
  return null;
}

function reservedFrameworkPrefixViolation(
  declaredPrefix: string,
  effectivePrefix: string,
): string | null {
  if (declaredPrefix.startsWith('fw-')) return declaredPrefix;
  if (effectivePrefix.startsWith('fw-')) return effectivePrefix;
  return null;
}

function isJisoPackage(packageName: string): boolean {
  return packageName.startsWith('@jiso/');
}

function aliasExample(prefix: string, packageName: string): string {
  const scopeOrName = packageName
    .replace(/^@/, '')
    .split('/')
    .find((part) => part.length > 0)
    ?.replace(/[^a-zA-Z0-9-]/g, '-')
    .toLowerCase();
  return `${scopeOrName ?? 'aliased'}-${prefix}`;
}

function packagePrefixDiagnostic(
  fileName: string,
  detail: string,
  help: readonly string[],
): CompilerDiagnostic {
  return {
    code: 'FW234',
    fileName,
    help: [diagnosticDefinitions.FW234.help, ...help].filter(Boolean).join('\n'),
    message: `${diagnosticDefinitions.FW234.message} ${detail}`,
    severity: diagnosticDefinitions.FW234.severity,
  };
}
