/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Mars icon (Lucide). https://lucide.dev/icons/mars */
export function Mars(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 3h5v5"></path>
      <path d="m21 3-6.75 6.75"></path>
      <circle cx="10" cy="14" r="6"></circle>
    </svg>
  );
}
