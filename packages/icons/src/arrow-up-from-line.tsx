/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Arrow Up From Line icon (Lucide). https://lucide.dev/icons/arrow-up-from-line */
export function ArrowUpFromLine(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m18 9-6-6-6 6"></path>
      <path d="M12 3v14"></path>
      <path d="M5 21h14"></path>
    </svg>
  );
}
