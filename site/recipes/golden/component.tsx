import { component } from '@kovojs/core';

export const SaveButton = component({
  props: { label: String },
  render(props: { label: string }) {
    return <button type="submit">{props.label}</button>;
  },
});
