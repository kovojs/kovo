/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Tally 4 icon (Lucide). https://lucide.dev/icons/tally-4 */
export function Tally4(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4 4v16"></path>
      <path d="M9 4v16"></path>
      <path d="M14 4v16"></path>
      <path d="M19 4v16"></path>
    </svg>
  );
}
