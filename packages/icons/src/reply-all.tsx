/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Reply All icon (Lucide). https://lucide.dev/icons/reply-all */
export function ReplyAll(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m12 17-5-5 5-5"></path>
      <path d="M22 18v-2a4 4 0 0 0-4-4H7"></path>
      <path d="m7 17-5-5 5-5"></path>
    </svg>
  );
}
