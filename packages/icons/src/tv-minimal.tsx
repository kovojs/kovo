/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Tv Minimal icon (Lucide). https://lucide.dev/icons/tv-minimal */
export function TvMinimal(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M7 21h10"></path>
      <rect width="20" height="14" x="2" y="3" rx="2"></rect>
    </svg>
  );
}
