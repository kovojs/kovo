/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Radio icon (Lucide). https://lucide.dev/icons/radio */
export function Radio(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16.247 7.761a6 6 0 0 1 0 8.478"></path>
      <path d="M19.075 4.933a10 10 0 0 1 0 14.134"></path>
      <path d="M4.925 19.067a10 10 0 0 1 0-14.134"></path>
      <path d="M7.753 16.239a6 6 0 0 1 0-8.478"></path>
      <circle cx="12" cy="12" r="2"></circle>
    </svg>
  );
}
