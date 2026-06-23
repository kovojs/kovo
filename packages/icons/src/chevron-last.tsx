/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Chevron Last icon (Lucide). https://lucide.dev/icons/chevron-last */
export function ChevronLast(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m7 18 6-6-6-6"></path>
      <path d="M17 6v12"></path>
    </svg>
  );
}
