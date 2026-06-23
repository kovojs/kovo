/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Toggle Right icon (Lucide). https://lucide.dev/icons/toggle-right */
export function ToggleRight(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="15" cy="12" r="3"></circle>
      <rect width="20" height="14" x="2" y="5" rx="7"></rect>
    </svg>
  );
}
