// @jiso-ir
import { applyCompiledQueryUpdatePlan } from '@jiso/runtime';

export const CartBadge$queryUpdatePlans = {
  "cart"(root, value) {
    return applyCompiledQueryUpdatePlan(root, "cart", value, { bindings: true, derives: [], stamps: [], templateStamps: [] });
  },
};
