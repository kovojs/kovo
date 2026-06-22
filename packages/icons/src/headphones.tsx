/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Headphones icon (Lucide). https://lucide.dev/icons/headphones */
export function Headphones(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"></path>
    </svg>
  );
}
