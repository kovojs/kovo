export interface ModelForSourceChangeOptions<Model> {
  fileName: string;
  nextSource: string;
  parse: (fileName: string, source: string) => Model;
  previousModel: Model;
  previousSource: string;
}

export function modelForSourceChange<Model>(options: ModelForSourceChangeOptions<Model>): Model {
  return options.nextSource === options.previousSource
    ? options.previousModel
    : options.parse(options.fileName, options.nextSource);
}
