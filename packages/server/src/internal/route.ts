export {
  findRouteAmbiguities,
  matchRoute,
  normalizePathname,
  type PathnameNormalization,
  type RouteAmbiguity,
  type RouteLike,
  type RouteMatch,
} from '../match.js';
export {
  defineCompiledRoutePage,
  type CompiledRoutePageComponent,
  type CompiledRoutePageComponentProp,
  type CompiledRoutePageFunction,
  type CompiledRoutePageMetadata,
} from '../route-ir.js';
export {
  matchShellDispatch,
  shellDispatchTable,
  type EndpointLike,
  type ShellDispatchEntry,
  type ShellDispatchInput,
  type ShellDispatchMatch,
  type ShellDispatchPhase,
} from '../shell.js';
