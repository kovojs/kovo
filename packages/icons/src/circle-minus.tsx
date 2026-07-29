/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Minus icon (Lucide). https://lucide.dev/icons/circle-minus */
export function CircleMinus(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M8 12h8"></path>
    </svg>
  );
}
