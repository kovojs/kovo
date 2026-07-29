/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** User Round icon (Lucide). https://lucide.dev/icons/user-round */
export function UserRound(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="8" r="5"></circle>
      <path d="M20 21a8 8 0 0 0-16 0"></path>
    </svg>
  );
}
