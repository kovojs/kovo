/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Captions icon (Lucide). https://lucide.dev/icons/captions */
export function Captions(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="14" x="3" y="5" rx="2" ry="2"></rect>
      <path d="M7 15h4M15 15h2M7 11h2M13 11h4"></path>
    </svg>
  );
}
