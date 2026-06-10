export type { DiagnosticCode } from '@jiso/core';

export interface JisoTableAnnotation {
  domain: string;
  key?: string;
}

export function jiso(annotation: JisoTableAnnotation): JisoTableAnnotation {
  return annotation;
}
