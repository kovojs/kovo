/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Section icon (Lucide). https://lucide.dev/icons/section */
export function Section(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 5a4 3 0 0 0-8 0c0 4 8 3 8 7a4 3 0 0 1-8 0"></path>
      <path d="M8 19a4 3 0 0 0 8 0c0-4-8-3-8-7a4 3 0 0 1 8 0"></path>
    </svg>
  );
}
