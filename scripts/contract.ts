import Ajv from "ajv";
import standaloneCode from "ajv/dist/standalone/index.js";

type Obj = Record<string, unknown>;
const schemaKeys = new Set([
  "$ref",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "const",
  "enum",
  "minLength",
  "maxLength",
]);
const methodName = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;
const identifier = /^[A-Za-z_$][\w$]*$/;
function fail(where: string, reason: string): never {
  throw new Error(`${where}: ${reason}`);
}
function object(value: unknown, where: string): Obj {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : fail(where, "expected object");
}
function list(value: unknown, where: string): unknown[] {
  return Array.isArray(value)
    ? (value as unknown[])
    : fail(where, "expected array");
}

/** Generate reviewable artifacts from the bounded OpenRPC 1.3.2 / JSON Schema draft-07 profile. */
export function generateContract(document: unknown, source: string) {
  const doc = object(document, "OpenRPC document");
  if (doc["openrpc"] !== "1.3.2") fail("openrpc", "expected 1.3.2");
  const methods = list(doc["methods"], "methods");
  if (!methods.length) fail("methods", "expected nonempty array");
  const components =
    doc["components"] === undefined
      ? {}
      : object(doc["components"], "components");
  const schemas =
    components["schemas"] === undefined
      ? {}
      : object(components["schemas"], "components.schemas");
  const refs = new Map<string, Obj>();
  for (const [key, value] of Object.entries(schemas)) {
    if (!identifier.test(key))
      fail(`components.schemas.${key}`, "invalid schema name");
    refs.set(
      `#/components/schemas/${key}`,
      object(value, `components.schemas.${key}`),
    );
  }
  const checkSchema = (
    value: unknown,
    where: string,
    stack: string[] = [],
  ): { ts: string; schema: Obj } => {
    const schema = object(value, where);
    for (const key of Object.keys(schema))
      if (!schemaKeys.has(key)) fail(where, `unsupported keyword ${key}`);
    if ("$ref" in schema) {
      const ref = schema["$ref"];
      if (Object.keys(schema).length !== 1)
        fail(where, "$ref cannot have siblings");
      if (typeof ref !== "string" || !refs.has(ref))
        fail(where, `unresolved or external reference ${String(ref)}`);
      if (stack.includes(ref)) fail(where, `circular reference ${ref}`);
      return checkSchema(refs.get(ref), ref, [...stack, ref]);
    }
    const declared =
      schema["type"] ??
      ("const" in schema
        ? schema["const"] === null
          ? "null"
          : typeof schema["const"]
        : undefined);
    const types: unknown[] = Array.isArray(declared) ? declared : [declared];
    if (
      !types.length ||
      new Set(types).size !== types.length ||
      types.some(
        (type) =>
          !["object", "string", "boolean", "null"].includes(type as string),
      )
    )
      fail(where, "unsupported type");
    if (types.length > 2 || (types.length === 2 && !types.includes("null")))
      fail(where, "only nullable unions are supported");
    const kind =
      (types.find((type) => type !== "null") as string | undefined) ?? "null";
    const literal = schema["const"];
    const values = schema["enum"];
    if (types.length === 2 && ("const" in schema || values !== undefined))
      fail(
        where,
        "nullable literals are unsupported; use a nullable primitive type",
      );
    if (
      "const" in schema &&
      (!["string", "boolean", "null"].includes(kind) ||
        (literal === null ? "null" : typeof literal) !== kind)
    )
      fail(where, "const does not match type");
    if (
      values !== undefined &&
      (!Array.isArray(values) ||
        !values.length ||
        values.some(
          (item: unknown) =>
            !["string", "boolean"].includes(kind) || typeof item !== kind,
        ))
    )
      fail(where, "enum must contain matching literals");
    if ("const" in schema && values !== undefined)
      fail(where, "const and enum cannot be combined");
    if (kind !== "string" && ("minLength" in schema || "maxLength" in schema))
      fail(where, "string limits require string type");
    for (const key of ["minLength", "maxLength"])
      if (
        key in schema &&
        (typeof schema[key] !== "number" ||
          !Number.isSafeInteger(schema[key]) ||
          (schema[key] as number) < 0)
      )
        fail(where, `${key} must be nonnegative integer`);
    if (
      typeof schema["minLength"] === "number" &&
      typeof schema["maxLength"] === "number" &&
      schema["minLength"] > schema["maxLength"]
    )
      fail(where, "minLength exceeds maxLength");
    if (
      kind !== "object" &&
      ["properties", "required", "additionalProperties"].some(
        (key) => key in schema,
      )
    )
      fail(where, "object keywords require object type");
    let ts: string;
    let normalized: Obj = { ...schema };
    if (kind === "object") {
      if (
        types.length !== 1 ||
        "const" in schema ||
        values !== undefined ||
        schema["additionalProperties"] !== false
      )
        fail(
          where,
          "object requires additionalProperties: false and no unions or literals",
        );
      const properties = object(
        schema["properties"] ?? {},
        `${where}.properties`,
      );
      const required = list(schema["required"] ?? [], `${where}.required`);
      if (
        new Set(required).size !== required.length ||
        required.some(
          (key) => typeof key !== "string" || !Object.hasOwn(properties, key),
        )
      )
        fail(where, "required must list unique declared properties");
      const props: Obj = {};
      ts =
        Object.keys(properties).length === 0
          ? "Record<string, never>"
          : `{ ${Object.entries(properties)
              .map(([key, item]) => {
                const child = checkSchema(
                  item,
                  `${where}.properties.${key}`,
                  stack,
                );
                props[key] = child.schema;
                return `${JSON.stringify(key)}${required.includes(key) ? "" : "?"}: ${child.ts}`;
              })
              .join("; ")} }`;
      normalized = { ...schema, properties: props };
    } else {
      ts =
        "const" in schema
          ? JSON.stringify(literal)
          : Array.isArray(values)
            ? values.map((item: unknown) => JSON.stringify(item)).join(" | ")
            : kind;
      if (types.length === 2) ts += " | null";
      if (schema["type"] === undefined) normalized = { ...schema, type: kind };
    }
    return { ts, schema: normalized };
  };
  for (const [ref, schema] of refs) checkSchema(schema, ref);
  const ajv = new Ajv({
    code: { source: true, esm: true },
    strict: true,
    ownProperties: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
  });
  const entries: string[] = [];
  const exports: Record<string, string> = {};
  const names = new Set<string>();
  methods.forEach((value, index) => {
    const where = `methods[${index}]`;
    const method = object(value, where);
    const name = method["name"];
    if (typeof name !== "string" || !methodName.test(name) || names.has(name))
      fail(where, `invalid or duplicate method name ${String(name)}`);
    names.add(name);
    if (method["paramStructure"] !== "by-name")
      fail(where, "by-name params required");
    const params = list(method["params"], `${where}.params`);
    const properties: Obj = {};
    const required: string[] = [];
    for (const item of params) {
      const param = object(item, `${where}.params`);
      const key = param["name"];
      if (
        typeof key !== "string" ||
        !identifier.test(key) ||
        ["__proto__", "constructor", "prototype"].includes(key) ||
        Object.hasOwn(properties, key)
      )
        fail(where, `invalid or duplicate parameter name ${String(key)}`);
      if (
        param["required"] !== undefined &&
        typeof param["required"] !== "boolean"
      )
        fail(where, `invalid required flag for ${key}`);
      properties[key] = param["schema"];
      if (param["required"]) required.push(key);
    }
    const input = checkSchema(
      { type: "object", properties, required, additionalProperties: false },
      `${where}.params`,
    );
    const output = checkSchema(
      object(method["result"], `${where}.result`)["schema"],
      `${where}.result.schema`,
    );
    ajv.addSchema(input.schema, `rpc-input-${index}`);
    ajv.addSchema(output.schema, `rpc-output-${index}`);
    exports[`input${index}`] = `rpc-input-${index}`;
    exports[`output${index}`] = `rpc-output-${index}`;
    entries.push(
      `${JSON.stringify(name)}: { params: ${input.ts}; result: ${output.ts} };`,
    );
  });
  const heading = `// Generated from ${source}; do not edit.\n`;
  const contract = `${heading}import type { Result } from "neverthrow";\n\nexport interface Commands {\n${entries.map((entry) => `  ${entry}`).join("\n")}\n}\nexport type HandlerMap<Context, Failure> = {\n  [M in keyof Commands]: (params: Commands[M]["params"], context: Context) => Promise<Result<Commands[M]["result"], Failure>>;\n};\nexport type Caller = <M extends keyof Commands>(method: M, params: Commands[M]["params"]) => Promise<Commands[M]["result"]>;\n`;
  // Ajv emits a CommonJS helper for UTF-16 code-point length even with esm: true.
  const code = standaloneCode(ajv, exports).replaceAll(
    'require("ajv/dist/runtime/ucs2length").default',
    "(str => Array.from(str).length)",
  );
  if (code.includes("require("))
    fail("validators", "unsupported Ajv runtime helper in ESM output");
  const keys = [...names];
  const validators = `${heading}${code}\nexport const inputValidators = { ${keys.map((key, i) => `${JSON.stringify(key)}: input${i}`).join(", ")} };\nexport const outputValidators = { ${keys.map((key, i) => `${JSON.stringify(key)}: output${i}`).join(", ")} };\n`;
  const declarations = `${heading}import type { Commands } from "./contract";\ntype Validate<T> = (value: unknown) => value is T;\nexport const inputValidators: { [M in keyof Commands]: Validate<Commands[M]["params"]> };\nexport const outputValidators: { [M in keyof Commands]: Validate<Commands[M]["result"]> };\n`;
  return { contract, validators, declarations };
}
