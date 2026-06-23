/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Blend icon (Lucide). https://lucide.dev/icons/blend */
export function Blend(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="9" cy="9" r="7"></circle>
      <circle cx="15" cy="15" r="7"></circle>
    </svg>
  );
}
