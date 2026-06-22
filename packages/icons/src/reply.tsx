/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Reply icon (Lucide). https://lucide.dev/icons/reply */
export function Reply(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M20 18v-2a4 4 0 0 0-4-4H4"></path>
      <path d="m9 17-5-5 5-5"></path>
    </svg>
  );
}
