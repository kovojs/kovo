/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Cylinder icon (Lucide). https://lucide.dev/icons/cylinder */
export function Cylinder(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
      <path d="M3 5v14a9 3 0 0 0 18 0V5"></path>
    </svg>
  );
}
