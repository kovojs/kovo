/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Ellipse icon (Lucide). https://lucide.dev/icons/ellipse */
export function Ellipse(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <ellipse cx="12" cy="12" rx="10" ry="6"></ellipse>
    </svg>
  );
}
