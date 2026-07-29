/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** X icon (Lucide). https://lucide.dev/icons/x */
export function X(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M18 6 6 18"></path>
      <path d="m6 6 12 12"></path>
    </svg>
  );
}
