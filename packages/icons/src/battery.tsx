/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Battery icon (Lucide). https://lucide.dev/icons/battery */
export function Battery(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M 22 14 L 22 10"></path>
      <rect x="2" y="6" width="16" height="12" rx="2"></rect>
    </svg>
  );
}
