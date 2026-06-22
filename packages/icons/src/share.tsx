/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Share icon (Lucide). https://lucide.dev/icons/share */
export function Share(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 2v13"></path>
      <path d="m16 6-4-4-4 4"></path>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
    </svg>
  );
}
