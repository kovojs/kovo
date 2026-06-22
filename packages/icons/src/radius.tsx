/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Radius icon (Lucide). https://lucide.dev/icons/radius */
export function Radius(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M20.34 17.52a10 10 0 1 0-2.82 2.82"></path>
      <circle cx="19" cy="19" r="2"></circle>
      <path d="m13.41 13.41 4.18 4.18"></path>
      <circle cx="12" cy="12" r="2"></circle>
    </svg>
  );
}
