/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Non Binary icon (Lucide). https://lucide.dev/icons/non-binary */
export function NonBinary(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 2v10"></path>
      <path d="m8.5 4 7 4"></path>
      <path d="m8.5 8 7-4"></path>
      <circle cx="12" cy="17" r="5"></circle>
    </svg>
  );
}
