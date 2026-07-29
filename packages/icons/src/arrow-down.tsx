/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Arrow Down icon (Lucide). https://lucide.dev/icons/arrow-down */
export function ArrowDown(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 5v14"></path>
      <path d="m19 12-7 7-7-7"></path>
    </svg>
  );
}
