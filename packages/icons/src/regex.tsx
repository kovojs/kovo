/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Regex icon (Lucide). https://lucide.dev/icons/regex */
export function Regex(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M17 3v10"></path>
      <path d="m12.67 5.5 8.66 5"></path>
      <path d="m12.67 10.5 8.66-5"></path>
      <path d="M9 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2z"></path>
    </svg>
  );
}
