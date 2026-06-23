/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Pilcrow Right icon (Lucide). https://lucide.dev/icons/pilcrow-right */
export function PilcrowRight(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 3v11"></path>
      <path d="M10 9H7a1 1 0 0 1 0-6h8"></path>
      <path d="M14 3v11"></path>
      <path d="m18 14 4 4H2"></path>
      <path d="m22 18-4 4"></path>
    </svg>
  );
}
