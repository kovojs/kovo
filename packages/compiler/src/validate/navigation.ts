import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import { jsxElements, type ComponentModuleModel } from '../scan/parse.js';
import { dedupeBy } from '../shared.js';
import type { CompileComponentOptions } from '../types.js';

interface LiteralNavigationTarget {
  index: number;
  length: number;
  value: string;
}

export function validateLiteralHrefs(
  source: string,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const routes = options.registryFacts?.routes;
  if (!routes) return [];

  const missing = literalNavigationTargets(model).filter((target) => {
    if (isExternalNavigationTarget(target.value)) return false;
    return !routes.some((routePath) => routePathMatchesUrl(routePath, target.value));
  });

  return dedupeBy(missing, (target) => target.value).map((target) => ({
    ...diagnosticFor(options.fileName, 'KV220', source, target.index, target.length),
    message: `${diagnosticDefinitions.KV220.message} ${target.value}`,
  }));
}

function literalNavigationTargets(model: ComponentModuleModel): LiteralNavigationTarget[] {
  return jsxElements(model).flatMap((element) =>
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
  const routeSegments = routePath.split('/');
  const pathSegments = pathname.split('/');
  if (routeSegments.length !== pathSegments.length) return false;

  return routeSegments.every((segment, index) => {
    const pathSegment = pathSegments[index] ?? '';
    return segment.startsWith(':') ? pathSegment !== '' : segment === pathSegment;
  });
}
