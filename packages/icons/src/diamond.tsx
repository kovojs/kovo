/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Diamond icon (Lucide). https://lucide.dev/icons/diamond */
export function Diamond(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z"></path>
    </svg>
  );
}
