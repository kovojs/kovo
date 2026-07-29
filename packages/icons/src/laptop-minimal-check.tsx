/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Laptop Minimal Check icon (Lucide). https://lucide.dev/icons/laptop-minimal-check */
export function LaptopMinimalCheck(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 20h20"></path>
      <path d="m9 10 2 2 4-4"></path>
      <rect x="3" y="4" width="18" height="12" rx="2"></rect>
    </svg>
  );
}
