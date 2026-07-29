/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** List Todo icon (Lucide). https://lucide.dev/icons/list-todo */
export function ListTodo(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M13 5h8"></path>
      <path d="M13 12h8"></path>
      <path d="M13 19h8"></path>
      <path d="m3 17 2 2 4-4"></path>
      <rect x="3" y="4" width="6" height="6" rx="1"></rect>
    </svg>
  );
}
