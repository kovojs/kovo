// @ts-nocheck -- migration refusal intentionally uses the retired string-returning derive shape.
import { derive } from '@kovojs/browser';

export const cartLabel = derive(['cart'], (cart) => `${cart.count} items`);
