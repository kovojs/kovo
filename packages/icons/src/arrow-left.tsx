/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Arrow Left icon (Lucide). https://lucide.dev/icons/arrow-left */
export function ArrowLeft(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m12 19-7-7 7-7"></path>
      <path d="M19 12H5"></path>
    </svg>
  );
}
