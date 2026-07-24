import {
  encodeFrameworkFormTargetHeader,
  encodeFrameworkLiveTargetHeader,
  encodeFrameworkQueryDependencyToken,
  encodeFrameworkTargetHeader,
} from '../../packages/core/src/internal/wire-input-grammar.js';

type TutorialMutationHeaders = Record<string, readonly string[] | string | undefined>;

interface TutorialLiveTargetDescriptor {
  component: string;
  props: Record<string, unknown>;
  target: string;
}

/**
 * Encode the tutorial's readable target declarations through the same closed
 * grammar used by emitted browser code (SPEC.md §9.1/§9.3).
 */
export function encodeTutorialMutationHeaders(
  headers: TutorialMutationHeaders,
  attest: (descriptor: TutorialLiveTargetDescriptor) => string,
): TutorialMutationHeaders {
  const encoded = { ...headers };
  const liveTargets = headers['Kovo-Live-Targets'];
  if (typeof liveTargets === 'string') {
    encoded['Kovo-Live-Targets'] = encodeFrameworkLiveTargetHeader(
      liveTargets.split(';').map((entry) => {
        const trimmed = entry.trim();
        const componentSeparator = trimmed.indexOf('#');
        const propsSeparator = trimmed.indexOf(':', componentSeparator + 1);
        if (componentSeparator <= 0 || propsSeparator <= componentSeparator + 1) {
          throw new TypeError(`Invalid tutorial live target: ${trimmed}`);
        }
        const descriptor = {
          component: trimmed.slice(componentSeparator + 1, propsSeparator),
          props: JSON.parse(trimmed.slice(propsSeparator + 1)) as Record<string, unknown>,
          target: trimmed.slice(0, componentSeparator),
        };
        return {
          attestation: attest(descriptor),
          component: descriptor.component,
          propsSource: JSON.stringify(descriptor.props),
          target: descriptor.target,
        };
      }),
    );
  }

  const targets = headers['Kovo-Targets'];
  if (typeof targets === 'string') {
    encoded['Kovo-Targets'] = encodeFrameworkTargetHeader(
      targets.split(';').map((entry) => {
        const [target = '', query] = entry.trim().split('=');
        return {
          deps: query === undefined ? [] : [{ name: query }],
          target,
        };
      }),
    );
  }

  const formTarget = headers['Kovo-Form-Target'];
  if (typeof formTarget === 'string') {
    encoded['Kovo-Form-Target'] = encodeFrameworkFormTargetHeader(formTarget);
  }

  return encoded;
}

export function encodeTutorialQueryDependency(name: string): string {
  const encoded = encodeFrameworkQueryDependencyToken(name);
  if (encoded === undefined) throw new TypeError(`Invalid tutorial query identity: ${name}`);
  return encoded;
}
