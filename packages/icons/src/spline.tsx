/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Spline icon (Lucide). https://lucide.dev/icons/spline */
export function Spline(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="19" cy="5" r="2"></circle>
      <circle cx="5" cy="19" r="2"></circle>
      <path d="M5 17A12 12 0 0 1 17 5"></path>
    </svg>
  );
}
