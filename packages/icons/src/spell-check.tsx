/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Spell Check icon (Lucide). https://lucide.dev/icons/spell-check */
export function SpellCheck(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m6 16 6-12 6 12"></path>
      <path d="M8 12h8"></path>
      <path d="m16 20 2 2 4-4"></path>
    </svg>
  );
}
