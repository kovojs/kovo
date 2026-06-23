/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Trending Up icon (Lucide). https://lucide.dev/icons/trending-up */
export function TrendingUp(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 7h6v6"></path>
      <path d="m22 7-8.5 8.5-5-5L2 17"></path>
    </svg>
  );
}
