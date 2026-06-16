export function activate(
  _event: Event,
  context: { params: { label?: string }; state: { count?: number } },
): void {
  context.state.count = (context.state.count ?? 0) + 1;
  const output = document.querySelector('[data-island-output]');
  if (!output) return;
  output.setAttribute('data-label', context.params.label ?? '');
}
