/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Arrow Up Left icon (Lucide). https://lucide.dev/icons/square-arrow-up-left */
export function SquareArrowUpLeft(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M15 15 9 9"></path>
      <path d="M9 15V9h6"></path>
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
    </svg>
  );
}
