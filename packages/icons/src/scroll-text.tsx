/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Scroll Text icon (Lucide). https://lucide.dev/icons/scroll-text */
export function ScrollText(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M15 12h-5"></path>
      <path d="M15 8h-5"></path>
      <path d="M19 17V5a2 2 0 0 0-2-2H4"></path>
      <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"></path>
    </svg>
  );
}
