/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Move Left icon (Lucide). https://lucide.dev/icons/move-left */
export function MoveLeft(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M6 8L2 12L6 16"></path>
      <path d="M2 12H22"></path>
    </svg>
  );
}
