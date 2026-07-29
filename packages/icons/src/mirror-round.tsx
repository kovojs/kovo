/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Mirror Round icon (Lucide). https://lucide.dev/icons/mirror-round */
export function MirrorRound(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 6.6 8.6 8"></path>
      <path d="M12 18v4"></path>
      <path d="M15 7.5 9.5 13"></path>
      <path d="M7 22h10"></path>
      <circle cx="12" cy="10" r="8"></circle>
    </svg>
  );
}
