export type DialogInvokerCommand = 'close' | 'request-close' | 'show-modal';

interface DialogInvokerElement {
  closest?: (selector: string) => unknown;
  getAttribute?: (name: string) => string | null;
  ownerDocument?: {
    getElementById?: (id: string) => unknown;
  };
}

interface DialogCommandTarget {
  close?: () => void;
  open?: boolean;
  removeAttribute?: (name: string) => void;
  requestClose?: () => void;
  setAttribute?: (name: string, value: string) => void;
  showModal?: () => void;
}

export interface DialogInvokerEvent {
  currentTarget?: unknown;
  defaultPrevented?: boolean;
  preventDefault?: () => void;
  target?: unknown;
}

export function runDialogInvokerCommand(
  event: DialogInvokerEvent,
  expectedCommand: DialogInvokerCommand,
): boolean {
  if (event.defaultPrevented) return false;

  const invoker = resolveDialogInvoker(event);
  const command = invoker?.getAttribute?.('command');
  const contentId = invoker?.getAttribute?.('commandfor');
  const target = contentId ? invoker?.ownerDocument?.getElementById?.(contentId) : undefined;

  if (command !== expectedCommand || !isDialogCommandTarget(target)) return false;

  const invoked = invokeDialogCommand(target, expectedCommand);
  if (invoked) event.preventDefault?.();

  return invoked;
}

function resolveDialogInvoker(event: DialogInvokerEvent): DialogInvokerElement | undefined {
  if (isDialogInvokerElement(event.currentTarget)) return event.currentTarget;
  if (isDialogInvokerElement(event.target)) return event.target;

  const closest = (event.target as DialogInvokerElement | undefined)?.closest?.(
    '[command][commandfor]',
  );
  return isDialogInvokerElement(closest) ? closest : undefined;
}

function invokeDialogCommand(target: DialogCommandTarget, command: DialogInvokerCommand): boolean {
  if (command === 'show-modal') {
    if (target.open === true) return true;
    if (typeof target.showModal === 'function') {
      target.showModal();
      return true;
    }
    return false;
  }

  if (command === 'request-close' && typeof target.requestClose === 'function') {
    target.requestClose();
    return true;
  }
  if (typeof target.close === 'function') {
    target.close();
    return true;
  }
  if (target.open === true && typeof target.removeAttribute === 'function') {
    target.removeAttribute('open');
    return true;
  }
  return target.open === false;
}

function isDialogInvokerElement(value: unknown): value is DialogInvokerElement {
  return typeof (value as DialogInvokerElement | undefined)?.getAttribute === 'function';
}

function isDialogCommandTarget(value: unknown): value is DialogCommandTarget {
  const target = value as DialogCommandTarget | undefined;
  return (
    typeof target?.showModal === 'function' ||
    typeof target?.requestClose === 'function' ||
    typeof target?.close === 'function' ||
    typeof target?.removeAttribute === 'function'
  );
}
