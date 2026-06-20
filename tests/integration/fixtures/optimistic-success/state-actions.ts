interface ToggleState {
  on: boolean;
}

// Pure-client island handler: flips local state. Used by the multi-feature test to
// prove a sibling island's state survives an optimistic mutation + fragment morph.
export function toggle(_event: Event, ctx: { state: ToggleState }): void {
  ctx.state.on = !ctx.state.on;
}
