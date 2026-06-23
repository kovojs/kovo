/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Cone icon (Lucide). https://lucide.dev/icons/cone */
export function Cone(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m20.9 18.55-8-15.98a1 1 0 0 0-1.8 0l-8 15.98"></path>
      <ellipse cx="12" cy="19" rx="9" ry="3"></ellipse>
    </svg>
  );
}
