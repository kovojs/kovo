/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Tablets icon (Lucide). https://lucide.dev/icons/tablets */
export function Tablets(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="7" cy="7" r="5"></circle>
      <circle cx="17" cy="17" r="5"></circle>
      <path d="M12 17h10"></path>
      <path d="m3.46 10.54 7.08-7.08"></path>
    </svg>
  );
}
