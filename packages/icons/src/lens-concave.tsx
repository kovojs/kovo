/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Lens Concave icon (Lucide). https://lucide.dev/icons/lens-concave */
export function LensConcave(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M7 2a1 1 0 0 0-.8 1.6 14 14 0 0 1 0 16.8A1 1 0 0 0 7 22h10a1 1 0 0 0 .8-1.6 14 14 0 0 1 0-16.8A1 1 0 0 0 17 2z"></path>
    </svg>
  );
}
