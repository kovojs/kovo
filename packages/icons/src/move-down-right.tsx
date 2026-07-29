/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Move Down Right icon (Lucide). https://lucide.dev/icons/move-down-right */
export function MoveDownRight(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M19 13V19H13"></path>
      <path d="M5 5L19 19"></path>
    </svg>
  );
}
