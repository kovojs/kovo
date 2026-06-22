/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Swiss Franc icon (Lucide). https://lucide.dev/icons/swiss-franc */
export function SwissFranc(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 21V3h8"></path>
      <path d="M6 16h9"></path>
      <path d="M10 9.5h7"></path>
    </svg>
  );
}
