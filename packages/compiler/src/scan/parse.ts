import ts from 'typescript';

export interface ComponentOptionEntry {
  key: string;
  value: string;
}

export interface ComponentModel {
  explicitName?: string;
  localName?: string;
  options: readonly ComponentOptionEntry[];
}

export interface ComponentModuleModel {
  components: readonly ComponentModel[];
}

export function parseComponentModule(fileName: string, source: string): ComponentModuleModel {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const components: ComponentModel[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const model = componentModelFromInitializer(
        sourceFile,
        source,
        node.name.text,
        node.initializer,
      );
      if (model) components.push(model);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return { components };
}

export function firstComponentModel(model: ComponentModuleModel): ComponentModel | null {
  return model.components[0] ?? null;
}

export function componentOptionSource(
  model: ComponentModuleModel,
  propertyName: string,
): string | null {
  return (
    firstComponentModel(model)?.options.find((option) => option.key === propertyName)?.value ?? null
  );
}

function componentModelFromInitializer(
  sourceFile: ts.SourceFile,
  source: string,
  localName: string,
  initializer: ts.Expression | undefined,
): ComponentModel | null {
  if (!initializer || !ts.isCallExpression(initializer)) return null;
  if (!ts.isIdentifier(initializer.expression) || initializer.expression.text !== 'component')
    return null;

  const [nameArg, optionsArg] = initializer.arguments;
  const explicitName = nameArg && ts.isStringLiteralLike(nameArg) ? nameArg.text : undefined;
  const options =
    optionsArg && ts.isObjectLiteralExpression(optionsArg)
      ? componentOptions(sourceFile, source, optionsArg)
      : [];

  return {
    ...(explicitName === undefined ? {} : { explicitName }),
    localName,
    options,
  };
}

function componentOptions(
  sourceFile: ts.SourceFile,
  source: string,
  optionsObject: ts.ObjectLiteralExpression,
): ComponentOptionEntry[] {
  return optionsObject.properties.flatMap((property) => {
    if (!ts.isPropertyAssignment(property)) return [];

    const key = propertyNameText(property.name);
    if (!key) return [];

    return [
      {
        key,
        value: source.slice(
          property.initializer.getStart(sourceFile),
          property.initializer.getEnd(),
        ),
      },
    ];
  });
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return null;
}
