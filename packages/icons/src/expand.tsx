/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Expand icon (Lucide). https://lucide.dev/icons/expand */
export function Expand(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m15 15 6 6"></path>
      <path d="m15 9 6-6"></path>
      <path d="M21 16v5h-5"></path>
      <path d="M21 8V3h-5"></path>
      <path d="M3 16v5h5"></path>
      <path d="m3 21 6-6"></path>
      <path d="M3 8V3h5"></path>
      <path d="M9 9 3 3"></path>
    </svg>
  );
}
