/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Corner Right Down icon (Lucide). https://lucide.dev/icons/corner-right-down */
export function CornerRightDown(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m10 15 5 5 5-5"></path>
      <path d="M4 4h7a4 4 0 0 1 4 4v12"></path>
    </svg>
  );
}
