/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Move Up Left icon (Lucide). https://lucide.dev/icons/move-up-left */
export function MoveUpLeft(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M5 11V5H11"></path>
      <path d="M5 5L19 19"></path>
    </svg>
  );
}
