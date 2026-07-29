import { derive } from '@kovojs/browser';

export const cartLabel = derive(['cart'], (cart) => `${cart.count} items`);
