/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Slash icon (Lucide). https://lucide.dev/icons/circle-slash */
export function CircleSlash(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="9" x2="15" y1="15" y2="9"></line>
    </svg>
  );
}
