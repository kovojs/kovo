/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Chevron Right icon (Lucide). https://lucide.dev/icons/chevron-right */
export function ChevronRight(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m9 18 6-6-6-6"></path>
    </svg>
  );
}
