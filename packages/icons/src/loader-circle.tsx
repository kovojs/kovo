/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Loader Circle icon (Lucide). https://lucide.dev/icons/loader-circle */
export function LoaderCircle(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
    </svg>
  );
}
