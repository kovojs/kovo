/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

declare const Primitive: {
  Toggle: (props: Record<string, unknown>) => string;
};

export const PrimitiveStateAttrsCard = component({
  state: () => ({ active: false }),
  render: (_queries, state) => (
    <section data-case="primitive-state-attrs">
      <Primitive.Toggle
        attrs={{
          'aria-pressed': state.active ? 'true' : 'false',
          class: 'primitive-toggle',
          'data-state': state.active ? 'on' : 'off',
          onClick: () => {
            state.active = !state.active;
          },
          type: 'button',
        }}
      >
        {(attrs: Record<string, string>) => (
          <button
            {...attrs}
            class="author-toggle"
            data-case="primitive-state-toggle"
            data-state="author-static"
          >
            Alerts
          </button>
        )}
      </Primitive.Toggle>
    </section>
  ),
});
