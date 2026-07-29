/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** X Line Top icon (Lucide). https://lucide.dev/icons/x-line-top */
export function XLineTop(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M18 4H6"></path>
      <path d="M18 8 6 20"></path>
      <path d="m6 8 12 12"></path>
    </svg>
  );
}
