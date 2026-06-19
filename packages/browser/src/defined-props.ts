export type DefinedProps<Props extends object> = {
  [Key in keyof Props]?: Exclude<Props[Key], undefined>;
};

export function definedProps<Props extends object>(props: Props): DefinedProps<Props> {
  return Object.fromEntries(
    Object.entries(props).filter((entry) => {
      const [, value] = entry;
      return value !== undefined;
    }),
  ) as DefinedProps<Props>;
}
