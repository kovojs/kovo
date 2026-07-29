/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Credit Card icon (Lucide). https://lucide.dev/icons/credit-card */
export function CreditCard(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="20" height="14" x="2" y="5" rx="2"></rect>
      <line x1="2" x2="22" y1="10" y2="10"></line>
    </svg>
  );
}
