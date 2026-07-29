/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Arrow Right From Line icon (Lucide). https://lucide.dev/icons/arrow-right-from-line */
export function ArrowRightFromLine(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 5v14"></path>
      <path d="M21 12H7"></path>
      <path d="m15 18 6-6-6-6"></path>
    </svg>
  );
}
