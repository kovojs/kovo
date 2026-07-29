/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Dot icon (Lucide). https://lucide.dev/icons/circle-dot */
export function CircleDot(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <circle cx="12" cy="12" r="1"></circle>
    </svg>
  );
}
