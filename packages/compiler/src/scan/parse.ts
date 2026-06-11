import ts from 'typescript';

export interface ComponentOptionEntry {
  key: string;
  value: string;
}

export interface ComponentModel {
  explicitName?: string;
  localName?: string;
  options: readonly ComponentOptionEntry[];
  renderInputs: readonly string[];
  stateReturnObject?: string;
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

export function componentRenderInputs(model: ComponentModuleModel): string[] {
  return [...(firstComponentModel(model)?.renderInputs ?? [])];
}

export function componentStateReturnObject(model: ComponentModuleModel): string | null {
  return firstComponentModel(model)?.stateReturnObject ?? null;
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
  const render = componentPropertyInitializer(optionsArg, 'render');
  const state = componentPropertyInitializer(optionsArg, 'state');
  const stateReturnObject = state ? arrowReturnObjectSource(sourceFile, source, state) : null;

  return {
    ...(explicitName === undefined ? {} : { explicitName }),
    localName,
    options,
    renderInputs: render ? arrowObjectPatternKeys(render) : [],
    ...(stateReturnObject === null ? {} : { stateReturnObject }),
  };
}

function componentPropertyInitializer(
  optionsObject: ts.Expression | undefined,
  propertyName: string,
): ts.Expression | null {
  if (!optionsObject || !ts.isObjectLiteralExpression(optionsObject)) return null;

  for (const property of optionsObject.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.name) === propertyName) return property.initializer;
  }

  return null;
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

function arrowObjectPatternKeys(expression: ts.Expression): string[] {
  if (!ts.isArrowFunction(expression)) return [];

  const firstParam = expression.parameters[0];
  if (!firstParam || !ts.isObjectBindingPattern(firstParam.name)) return [];

  return firstParam.name.elements.flatMap((element) =>
    ts.isIdentifier(element.name) ? [element.name.text] : [],
  );
}

function arrowReturnObjectSource(
  sourceFile: ts.SourceFile,
  source: string,
  expression: ts.Expression,
): string | null {
  if (!ts.isArrowFunction(expression)) return null;

  const body = ts.isParenthesizedExpression(expression.body)
    ? expression.body.expression
    : expression.body;
  if (!ts.isObjectLiteralExpression(body)) return null;

  return source.slice(body.getStart(sourceFile), body.getEnd());
}
