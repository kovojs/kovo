/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Kanban icon (Lucide). https://lucide.dev/icons/kanban */
export function Kanban(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M5 3v14"></path>
      <path d="M12 3v8"></path>
      <path d="M19 3v18"></path>
    </svg>
  );
}
