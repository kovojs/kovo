/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Plus icon (Lucide). https://lucide.dev/icons/plus */
export function Plus(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M5 12h14"></path>
      <path d="M12 5v14"></path>
    </svg>
  );
}
