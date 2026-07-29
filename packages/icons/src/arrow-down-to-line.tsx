/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Arrow Down To Line icon (Lucide). https://lucide.dev/icons/arrow-down-to-line */
export function ArrowDownToLine(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 17V3"></path>
      <path d="m6 11 6 6 6-6"></path>
      <path d="M19 21H5"></path>
    </svg>
  );
}
