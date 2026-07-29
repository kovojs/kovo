/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Tally 1 icon (Lucide). https://lucide.dev/icons/tally-1 */
export function Tally1(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4 4v16"></path>
    </svg>
  );
}
