/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Summary icon (Lucide). https://lucide.dev/icons/summary */
export function Summary(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M15 4H7"></path>
      <path d="m18 16 3 3-3 3"></path>
      <path d="M3 4v13a2 2 0 0 0 2 2h16"></path>
      <path d="M7 14h7"></path>
      <path d="M7 9h12"></path>
    </svg>
  );
}
