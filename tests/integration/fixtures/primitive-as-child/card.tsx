/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

declare const Primitive: {
  Trigger: (props: Record<string, unknown>) => string;
};

export const PrimitiveAsChildCard = component({
  render: () => (
    <section data-case="primitive-as-child">
      <Primitive.Trigger
        asChild
        attrs={{
          'aria-controls': 'as-child-panel',
          'aria-label': 'Primitive help',
          class: 'primitive-trigger primitive-base',
          'data-state': 'closed',
          onClick: () => {},
          role: 'button',
          style: 'color: red;',
        }}
      >
        <button
          class="author-trigger author-base"
          data-case="primitive-as-child-trigger"
          onClick={() => {}}
          style="background: blue;"
          type="submit"
        >
          Open account
        </button>
      </Primitive.Trigger>
      <div id="as-child-panel">Merged panel</div>
    </section>
  ),
});
