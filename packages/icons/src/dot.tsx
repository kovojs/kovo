/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Dot icon (Lucide). https://lucide.dev/icons/dot */
export function Dot(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12.1" cy="12.1" r="1"></circle>
    </svg>
  );
}
