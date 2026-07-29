/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Signal High icon (Lucide). https://lucide.dev/icons/signal-high */
export function SignalHigh(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 20h.01"></path>
      <path d="M7 20v-4"></path>
      <path d="M12 20v-8"></path>
      <path d="M17 20V8"></path>
    </svg>
  );
}
