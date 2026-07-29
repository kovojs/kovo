/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Menu icon (Lucide). https://lucide.dev/icons/menu */
export function Menu(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4 5h16"></path>
      <path d="M4 12h16"></path>
      <path d="M4 19h16"></path>
    </svg>
  );
}
