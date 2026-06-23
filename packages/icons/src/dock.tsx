/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Dock icon (Lucide). https://lucide.dev/icons/dock */
export function Dock(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 8h20"></path>
      <rect width="20" height="16" x="2" y="4" rx="2"></rect>
      <path d="M6 16h12"></path>
    </svg>
  );
}
