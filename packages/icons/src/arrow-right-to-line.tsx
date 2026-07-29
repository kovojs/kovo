/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Arrow Right To Line icon (Lucide). https://lucide.dev/icons/arrow-right-to-line */
export function ArrowRightToLine(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M17 12H3"></path>
      <path d="m11 18 6-6-6-6"></path>
      <path d="M21 5v14"></path>
    </svg>
  );
}
