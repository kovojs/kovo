/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Laptop Minimal icon (Lucide). https://lucide.dev/icons/laptop-minimal */
export function LaptopMinimal(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="12" x="3" y="4" rx="2" ry="2"></rect>
      <line x1="2" x2="22" y1="20" y2="20"></line>
    </svg>
  );
}
