/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Kanban icon (Lucide). https://lucide.dev/icons/square-kanban */
export function SquareKanban(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M8 7v7"></path>
      <path d="M12 7v4"></path>
      <path d="M16 7v9"></path>
    </svg>
  );
}
