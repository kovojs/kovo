/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Bot Message Square icon (Lucide). https://lucide.dev/icons/bot-message-square */
export function BotMessageSquare(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 6V2H8"></path>
      <path d="M15 11v2"></path>
      <path d="M2 12h2"></path>
      <path d="M20 12h2"></path>
      <path d="M20 16a2 2 0 0 1-2 2H8.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 4 20.286V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"></path>
      <path d="M9 11v2"></path>
    </svg>
  );
}
