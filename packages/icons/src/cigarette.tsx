/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Cigarette icon (Lucide). https://lucide.dev/icons/cigarette */
export function Cigarette(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M17 12H3a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h14"></path>
      <path d="M18 8c0-2.5-2-2.5-2-5"></path>
      <path d="M21 16a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"></path>
      <path d="M22 8c0-2.5-2-2.5-2-5"></path>
      <path d="M7 12v4"></path>
    </svg>
  );
}
