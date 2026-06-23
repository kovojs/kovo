/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Tv Minimal icon (Lucide). https://lucide.dev/icons/tv-minimal */
export function TvMinimal(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M7 21h10"></path>
      <rect width="20" height="14" x="2" y="3" rx="2"></rect>
    </svg>
  );
}
