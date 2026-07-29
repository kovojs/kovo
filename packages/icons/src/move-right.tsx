/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Move Right icon (Lucide). https://lucide.dev/icons/move-right */
export function MoveRight(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M18 8L22 12L18 16"></path>
      <path d="M2 12H22"></path>
    </svg>
  );
}
