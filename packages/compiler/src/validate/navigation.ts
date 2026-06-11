import { diagnosticDefinitions } from '@jiso/core';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import type { CompileComponentOptions } from '../index.js';
import { jsxElements, parseComponentModule } from '../scan/parse.js';
import { dedupeBy } from '../shared.js';

interface LiteralNavigationTarget {
  index: number;
  length: number;
  value: string;
}

export function validateLiteralHrefs(
  source: string,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const routes = options.registryFacts?.routes;
  if (!routes) return [];

  const missing = literalNavigationTargets(source).filter((target) => {
    if (isExternalNavigationTarget(target.value)) return false;
    return !routes.some((routePath) => routePathMatchesUrl(routePath, target.value));
  });

  return dedupeBy(missing, (target) => target.value).map((target) => ({
    ...diagnosticFor(options.fileName, 'FW220', source, target.index, target.length),
    message: `${diagnosticDefinitions.FW220.message} ${target.value}`,
  }));
}

function literalNavigationTargets(source: string): LiteralNavigationTarget[] {
  return jsxElements(parseComponentModule('component.tsx', source)).flatMap((element) =>
    element.attributes.flatMap((attribute) =>
      (attribute.name === 'href' || attribute.name === 'action') && attribute.value
        ? [
            {
              index: attribute.start,
              length: attribute.end - attribute.start,
              value: attribute.value,
            },
          ]
        : [],
    ),
  );
}

function isExternalNavigationTarget(target: string): boolean {
  return (
    target.startsWith('#') ||
    target.startsWith('mailto:') ||
    target.startsWith('tel:') ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(target)
  );
}

function routePathMatchesUrl(routePath: string, target: string): boolean {
  const pathname = target.split(/[?#]/, 1)[0] ?? '';
  const pattern = `^${routePath
    .split('/')
    .map((part) => (part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/')}$`;

  return new RegExp(pattern).test(pathname);
}
