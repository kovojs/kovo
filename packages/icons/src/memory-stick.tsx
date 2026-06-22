/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Memory Stick icon (Lucide). https://lucide.dev/icons/memory-stick */
export function MemoryStick(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 12v-2"></path>
      <path d="M12 18v-2"></path>
      <path d="M16 12v-2"></path>
      <path d="M16 18v-2"></path>
      <path d="M2 11h1.5"></path>
      <path d="M20 18v-2"></path>
      <path d="M20.5 11H22"></path>
      <path d="M4 18v-2"></path>
      <path d="M8 12v-2"></path>
      <path d="M8 18v-2"></path>
      <rect x="2" y="6" width="20" height="10" rx="2"></rect>
    </svg>
  );
}
