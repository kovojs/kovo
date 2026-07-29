import type { Component } from '@kovojs/core';
import { componentDefinitionForFramework } from '@kovojs/core/internal/component-render';

/**
 * Render one UI component definition for package-internal contract tests.
 *
 * Public consumers receive only the opaque `Component<Props>` handle. Tests use the same exact
 * framework-owned WeakMap association as the server renderer instead of reopening a structural
 * `.definition` escape hatch (SPEC §4.1/§6.6).
 */
export function renderUiComponent<Props extends object>(
  component: Component<Props>,
  props: Props,
): string {
  // UI definitions return the framework's string-coercible rendered-HTML carrier. Keeping that
  // carrier intact matters for nested raw composition; this test-only view exposes its authored
  // string behavior without widening the public component result back to `any`.
  return componentDefinitionForFramework(component).render(props) as string;
}
