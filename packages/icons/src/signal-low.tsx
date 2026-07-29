/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Signal Low icon (Lucide). https://lucide.dev/icons/signal-low */
export function SignalLow(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 20h.01"></path>
      <path d="M7 20v-4"></path>
    </svg>
  );
}
