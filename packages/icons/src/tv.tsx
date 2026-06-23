/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Tv icon (Lucide). https://lucide.dev/icons/tv */
export function Tv(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m17 2-5 5-5-5"></path>
      <rect width="20" height="15" x="2" y="7" rx="2"></rect>
    </svg>
  );
}
