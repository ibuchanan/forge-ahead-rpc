type Policy = Record<
  string,
  { execution: "asApp" | "asUser"; audit: "standard" | "critical" }
>;

function heading(source: string) {
  return `// Generated from ${source}; do not edit.\n`;
}

export function contractTemplate(source: string, entries: string[]) {
  return `${heading(source)}import type { Result } from "@forge-ahead/errors";\n\nexport interface Commands {\n${entries.map((entry) => `  ${entry}`).join("\n")}\n}\nexport type HandlerMap<Context, Failure> = {\n  [M in keyof Commands]: (params: Commands[M]["params"], context: Context) => Promise<Result<Commands[M]["result"], Failure>>;\n};\nexport type Caller = <M extends keyof Commands>(method: M, params: Commands[M]["params"]) => Promise<Commands[M]["result"]>;\n`;
}

export function validatorsTemplate(
  source: string,
  code: string,
  names: string[],
) {
  return `${heading(source)}${code}\nexport const inputValidators = { ${names.map((key, i) => `${JSON.stringify(key)}: input${i}`).join(", ")} };\nexport const outputValidators = { ${names.map((key, i) => `${JSON.stringify(key)}: output${i}`).join(", ")} };\n`;
}

export function declarationsTemplate(source: string) {
  return `${heading(source)}import type { Commands } from "./contract";\ntype Validate<T> = (value: unknown) => value is T;\nexport const inputValidators: { [M in keyof Commands]: Validate<Commands[M]["params"]> };\nexport const outputValidators: { [M in keyof Commands]: Validate<Commands[M]["result"]> };\n`;
}

export function policyTemplate(source: string, policy: Policy) {
  return `${heading(source)}export const webPolicy = {${Object.entries(policy)
    .map(
      ([name, value]) =>
        `\n  ${JSON.stringify(name)}: {\n    execution: ${JSON.stringify(value.execution)},\n    audit: ${JSON.stringify(value.audit)},\n  },`,
    )
    .join("")}${Object.keys(policy).length ? "\n" : ""}} as const;\n`;
}
