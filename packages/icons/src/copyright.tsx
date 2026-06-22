/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Copyright icon (Lucide). https://lucide.dev/icons/copyright */
export function Copyright(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M14.83 14.83a4 4 0 1 1 0-5.66"></path>
    </svg>
  );
}
