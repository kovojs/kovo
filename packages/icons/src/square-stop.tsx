/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Stop icon (Lucide). https://lucide.dev/icons/square-stop */
export function SquareStop(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <rect x="9" y="9" width="6" height="6" rx="1"></rect>
    </svg>
  );
}
