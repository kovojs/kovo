/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Message Square Share icon (Lucide). https://lucide.dev/icons/message-square-share */
export function MessageSquareShare(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 3H4a2 2 0 0 0-2 2v16.286a.71.71 0 0 0 1.212.502l2.202-2.202A2 2 0 0 1 6.828 19H20a2 2 0 0 0 2-2v-4"></path>
      <path d="M16 3h6v6"></path>
      <path d="m16 9 6-6"></path>
    </svg>
  );
}
