/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Terminal icon (Lucide). https://lucide.dev/icons/terminal */
export function Terminal(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 19h8"></path>
      <path d="m4 17 6-6-6-6"></path>
    </svg>
  );
}
