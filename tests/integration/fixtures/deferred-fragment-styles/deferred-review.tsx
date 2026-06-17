/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

export const DeferredReview = component({
  fragmentTarget: true,
  css: `
    .review-surface {
      background-color: rgb(12, 84, 96);
      color: rgb(255, 255, 255);
      padding: 12px;
    }
  `,
  render: () => (
    <section kovo-fragment-target="deferred-review">
      <div class="review-surface" data-review-card>
        Deferred review ready
      </div>
    </section>
  ),
});
