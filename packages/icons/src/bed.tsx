/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Bed icon (Lucide). https://lucide.dev/icons/bed */
export function Bed(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 4v16"></path>
      <path d="M2 8h18a2 2 0 0 1 2 2v10"></path>
      <path d="M2 17h20"></path>
      <path d="M6 8v9"></path>
    </svg>
  );
}
