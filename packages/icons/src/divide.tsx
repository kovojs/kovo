/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Divide icon (Lucide). https://lucide.dev/icons/divide */
export function Divide(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="6" r="1"></circle>
      <line x1="5" x2="19" y1="12" y2="12"></line>
      <circle cx="12" cy="18" r="1"></circle>
    </svg>
  );
}
