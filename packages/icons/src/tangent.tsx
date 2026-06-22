/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Tangent icon (Lucide). https://lucide.dev/icons/tangent */
export function Tangent(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="17" cy="4" r="2"></circle>
      <path d="M15.59 5.41 5.41 15.59"></path>
      <circle cx="4" cy="17" r="2"></circle>
      <path d="M12 22s-4-9-1.5-11.5S22 12 22 12"></path>
    </svg>
  );
}
