/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Tally 2 icon (Lucide). https://lucide.dev/icons/tally-2 */
export function Tally2(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4 4v16"></path>
      <path d="M9 4v16"></path>
    </svg>
  );
}
