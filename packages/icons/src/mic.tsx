/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Mic icon (Lucide). https://lucide.dev/icons/mic */
export function Mic(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 19v3"></path>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
      <rect x="9" y="2" width="6" height="13" rx="3"></rect>
    </svg>
  );
}
