import { createRequire } from 'node:module';
import * as ts from 'typescript';

type MutableTypescriptNamespace = typeof ts & Record<string, unknown>;

interface TypescriptCompatibilityApi {
  canHaveModifiers?: (node: ts.Node) => boolean;
  getEffectiveConstraintOfTypeParameter?: (
    node: ts.TypeParameterDeclaration,
  ) => ts.TypeNode | undefined;
  getModifiers?: (node: ts.Node) => readonly ts.ModifierLike[] | undefined;
}

interface TypescriptApiAdapter {
  canHaveModifiers(node: ts.Node): boolean;
  getEffectiveConstraintOfTypeParameter(node: ts.TypeParameterDeclaration): ts.TypeNode | undefined;
  getModifiers(node: ts.Node): readonly ts.ModifierLike[] | undefined;
  hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean;
}

const requireTypescript = createRequire(import.meta.url);
const defaultTsApi = createTypescriptApi(ts);

export function ensureTypescriptRuntime(typescript: typeof ts = ts): typeof ts {
  const mutableTs = typescript as MutableTypescriptNamespace;
  if (!('ScriptTarget' in mutableTs)) {
    Object.assign(mutableTs, requireTypescript('typescript') as typeof ts);
  }
  return typescript;
}

export function createTypescriptApi(typescript: typeof ts = ts): TypescriptApiAdapter {
  const runtime = ensureTypescriptRuntime(typescript);
  const compatibility = runtime as typeof ts & TypescriptCompatibilityApi;

  const adapter: TypescriptApiAdapter = {
    canHaveModifiers(node) {
      if (compatibility.canHaveModifiers) return compatibility.canHaveModifiers(node);
      return legacyModifiers(node) !== undefined;
    },
    getEffectiveConstraintOfTypeParameter(node) {
      if (compatibility.getEffectiveConstraintOfTypeParameter) {
        return compatibility.getEffectiveConstraintOfTypeParameter(node);
      }
      return node.constraint;
    },
    getModifiers(node) {
      if (compatibility.getModifiers && adapter.canHaveModifiers(node)) {
        return compatibility.getModifiers(node);
      }
      return legacyModifiers(node);
    },
    hasModifier(node, kind) {
      return adapter.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false;
    },
  };

  return adapter;
}

export function canHaveModifiers(node: ts.Node): boolean {
  return defaultTsApi.canHaveModifiers(node);
}

export function getModifiers(node: ts.Node): readonly ts.ModifierLike[] | undefined {
  return defaultTsApi.getModifiers(node);
}

export function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return defaultTsApi.hasModifier(node, kind);
}

export function getEffectiveConstraintOfTypeParameter(
  node: ts.TypeParameterDeclaration,
): ts.TypeNode | undefined {
  return defaultTsApi.getEffectiveConstraintOfTypeParameter(node);
}

function legacyModifiers(node: ts.Node): readonly ts.ModifierLike[] | undefined {
  return (node as ts.Node & { readonly modifiers?: readonly ts.ModifierLike[] }).modifiers;
}
