/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Torus icon (Lucide). https://lucide.dev/icons/torus */
export function Torus(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <ellipse cx="12" cy="11" rx="3" ry="2"></ellipse>
      <ellipse cx="12" cy="12.5" rx="10" ry="8.5"></ellipse>
    </svg>
  );
}
