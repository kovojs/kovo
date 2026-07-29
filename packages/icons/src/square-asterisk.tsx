/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Asterisk icon (Lucide). https://lucide.dev/icons/square-asterisk */
export function SquareAsterisk(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M12 8v8"></path>
      <path d="m8.5 14 7-4"></path>
      <path d="m8.5 10 7 4"></path>
    </svg>
  );
}
