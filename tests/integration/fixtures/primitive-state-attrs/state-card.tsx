/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

export const PrimitiveStateAttrsCard = component({
  render: () => (
    <section data-case="primitive-state-attrs">
      <Primitive.Toggle
        attrs={{
          'aria-pressed': 'false',
          class: 'primitive-toggle',
          'data-state': 'off',
          'on:click': '/client.ts#toggleState',
          type: 'button',
        }}
      >
        {(attrs) => (
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
