interface NullableState {
  contact: { name: string } | null;
}

export function fillContact(_event: Event, ctx: { state: NullableState }): void {
  ctx.state.contact = { name: 'Client Contact' };
}

export function clearContact(_event: Event, ctx: { state: NullableState }): void {
  ctx.state.contact = null;
}
