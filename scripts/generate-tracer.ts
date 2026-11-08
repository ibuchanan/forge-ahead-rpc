// Narrow one-method fixture generator; the full supported profile is ticket 02.
import { readFileSync, writeFileSync } from "node:fs";
import Ajv from "ajv";
import standaloneCode from "ajv/dist/standalone/index.js";

const doc = JSON.parse(readFileSync("examples/tracer/openrpc.json", "utf8"));
if (doc.methods.length !== 1 || doc.methods[0].paramStructure !== "by-name")
  throw new Error("Tracer requires one by-name method");
const method = doc.methods[0];
const props = (schema: {
  type: string;
  properties: Record<string, { type: string }>;
  required: string[];
}) => {
  if (
    schema.type !== "object" ||
    Object.keys(schema).some(
      (key) =>
        !["type", "properties", "required", "additionalProperties"].includes(
          key,
        ),
    )
  )
    throw new Error("Unsupported tracer result schema");
  return Object.entries(schema.properties)
    .map(([name, property]) => {
      if (property.type !== "string")
        throw new Error(`Unsupported tracer property: ${name}`);
      if (!/^[A-Za-z_$][\w$]*$/.test(name))
        throw new Error(`Unsupported tracer property name: ${name}`);
      return `${name}${schema.required.includes(name) ? "" : "?"}: string`;
    })
    .join(" ");
};
for (const param of method.params) {
  if (
    param.schema?.type !== "string" ||
    Object.keys(param.schema).some(
      (key) => !["type", "minLength"].includes(key),
    )
  )
    throw new Error(`Unsupported tracer parameter schema: ${param.name}`);
}
const input = {
  type: "object",
  properties: Object.fromEntries(
    method.params.map((p: { name: string; schema: unknown }) => [
      p.name,
      p.schema,
    ]),
  ),
  required: method.params
    .filter((p: { required?: boolean }) => p.required)
    .map((p: { name: string }) => p.name),
  additionalProperties: false,
};
const output = method.result.schema;
const types = `// Generated from examples/tracer/openrpc.json; do not edit.\nimport type { Result } from "neverthrow";\n\nexport interface Commands {\n  ${JSON.stringify(method.name)}: { params: { ${props(input)} }; result: { ${props(output)} } };\n}\nexport type HandlerMap<Context, Failure> = {\n  [M in keyof Commands]: (\n    params: Commands[M]["params"],\n    context: Context,\n  ) => Promise<Result<Commands[M]["result"], Failure>>;\n};\n`;
const ajv = new Ajv({
  code: { source: true, esm: true },
  strict: true,
  ownProperties: true,
});
ajv.addSchema(input, "tracer-input");
ajv.addSchema(output, "tracer-output");
const code = standaloneCode(ajv, {
  input: "tracer-input",
  output: "tracer-output",
});
const validators = `// Generated from examples/tracer/openrpc.json; do not edit.\n${code}\nexport const inputValidators = { ${JSON.stringify(method.name)}: input };\nexport const outputValidators = { ${JSON.stringify(method.name)}: output };\n`;
writeFileSync("examples/tracer/generated/contract.ts", types);
writeFileSync("examples/tracer/generated/validators.js", validators);
writeFileSync(
  "examples/tracer/generated/validators.d.ts",
  `// Generated from examples/tracer/openrpc.json; do not edit.\nimport type { Commands } from "./contract";\n\ntype Validate<T> = (value: unknown) => value is T;\nexport const inputValidators: {\n  [M in keyof Commands]: Validate<Commands[M]["params"]>;\n};\nexport const outputValidators: {\n  [M in keyof Commands]: Validate<Commands[M]["result"]>;\n};\n`,
);
