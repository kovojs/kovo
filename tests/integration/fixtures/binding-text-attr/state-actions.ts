interface BindingState {
  label: string;
  status: string;
  text: string;
}

export function advanceState(_event: Event, ctx: { state: BindingState }): void {
  ctx.state.text = 'Client text';
  ctx.state.label = 'Client card';
  ctx.state.status = 'ready';
}
