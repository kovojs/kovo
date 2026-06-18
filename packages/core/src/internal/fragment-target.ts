import type { FragmentTargets } from '../index.js';

type RegistryKey<Registry> = keyof Registry extends never
  ? string
  : Extract<keyof Registry, string>;

/** A fragment-target patch: the target name plus the props to re-render it with. */
export interface FragmentTargetPatch<Target extends string, Props> {
  props: Props;
  target: Target;
}

/**
 * Internal wire helper for framework tests and legacy generated flows. SPEC §9.1
 * says app authors never construct fragment targets or route mutations by hand.
 */
export function fragmentTarget<const Target extends RegistryKey<FragmentTargets>>(
  target: Target,
  props: Target extends keyof FragmentTargets ? FragmentTargets[Target] : Record<string, never>,
): FragmentTargetPatch<
  Target,
  Target extends keyof FragmentTargets ? FragmentTargets[Target] : Record<string, never>
> {
  return { props, target };
}
