/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Arrow Down Left icon (Lucide). https://lucide.dev/icons/square-arrow-down-left */
export function SquareArrowDownLeft(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M15 15H9l6-6"></path>
      <path d="M9 15V9"></path>
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
    </svg>
  );
}
