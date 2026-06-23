/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Laptop Minimal Check icon (Lucide). https://lucide.dev/icons/laptop-minimal-check */
export function LaptopMinimalCheck(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 20h20"></path>
      <path d="m9 10 2 2 4-4"></path>
      <rect x="3" y="4" width="18" height="12" rx="2"></rect>
    </svg>
  );
}
