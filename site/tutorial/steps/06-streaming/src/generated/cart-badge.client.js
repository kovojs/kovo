// @kovojs-ir
import { applyCompiledQueryUpdatePlan } from '@kovojs/runtime/generated';

export const CartBadge$queryUpdatePlans = {
  "cart"(root, value) {
    return applyCompiledQueryUpdatePlan(root, "cart", value, { bindings: true, derives: [], stamps: [], templateStamps: [] });
  },
};
