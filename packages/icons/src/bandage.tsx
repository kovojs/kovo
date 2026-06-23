/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Bandage icon (Lucide). https://lucide.dev/icons/bandage */
export function Bandage(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 10.01h.01"></path>
      <path d="M10 14.01h.01"></path>
      <path d="M14 10.01h.01"></path>
      <path d="M14 14.01h.01"></path>
      <path d="M18 6v12"></path>
      <path d="M6 6v12"></path>
      <rect x="2" y="6" width="20" height="12" rx="2"></rect>
    </svg>
  );
}
