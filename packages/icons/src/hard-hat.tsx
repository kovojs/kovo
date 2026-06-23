/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Hard Hat icon (Lucide). https://lucide.dev/icons/hard-hat */
export function HardHat(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5"></path>
      <path d="M14 6a6 6 0 0 1 6 6v3"></path>
      <path d="M4 15v-3a6 6 0 0 1 6-6"></path>
      <rect x="2" y="15" width="20" height="4" rx="1"></rect>
    </svg>
  );
}
