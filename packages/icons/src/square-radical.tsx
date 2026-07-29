/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Radical icon (Lucide). https://lucide.dev/icons/square-radical */
export function SquareRadical(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M7 12h2l2 5 2-10h4"></path>
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
    </svg>
  );
}
