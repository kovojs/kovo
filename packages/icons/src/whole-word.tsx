/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Whole Word icon (Lucide). https://lucide.dev/icons/whole-word */
export function WholeWord(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="7" cy="12" r="3"></circle>
      <path d="M10 9v6"></path>
      <circle cx="17" cy="12" r="3"></circle>
      <path d="M14 7v8"></path>
      <path d="M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1"></path>
    </svg>
  );
}
