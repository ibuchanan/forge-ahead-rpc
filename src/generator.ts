import Ajv from "ajv";
import standaloneCode from "ajv/dist/standalone/index.js";
import { methodMetadata } from "./exposure";
import {
  emitSchemaType,
  fail,
  list,
  object,
  validateSchema,
} from "./generator-schema";
import {
  contractTemplate,
  declarationsTemplate,
  policyTemplate,
  validatorsTemplate,
} from "./generator-templates";
type Obj = Record<string, unknown>;
type Policy = Record<
  string,
  { execution: "asApp" | "asUser"; audit: "standard" | "critical" }
>;
const methodName = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;
const identifier = /^[A-Za-z_$][\w$]*$/;

function compileValidators(ajv: Ajv, exports: Record<string, string>): string {
  // Ajv emits a CommonJS helper for UTF-16 code-point length even with esm: true.
  const code = standaloneCode(ajv, exports).replaceAll(
    'require("ajv/dist/runtime/ucs2length").default',
    "(str => Array.from(str).length)",
  );
  if (code.includes("require("))
    fail("validators", "unsupported Ajv runtime helper in ESM output");
  return code;
}

function schemaReferences(doc: Obj): Map<string, Obj> {
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
  for (const [ref, schema] of refs) validateSchema(schema, ref, refs);
  return refs;
}

function methodParams(method: Obj, where: string): Obj {
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
  return { type: "object", properties, required, additionalProperties: false };
}

function parseMethod(
  value: unknown,
  index: number,
  refs: Map<string, Obj>,
  names: Set<string>,
  policy: Policy,
) {
  const where = `methods[${index}]`;
  const method = object(value, where);
  const metadata = methodMetadata(method);
  const name = method["name"];
  if (typeof name !== "string" || !methodName.test(name) || names.has(name))
    fail(where, `invalid or duplicate method name ${String(name)}`);
  if (name === "rpc.discover") fail(where, "reserved method name rpc.discover");
  names.add(name);
  if (metadata.web === true && metadata.execution && metadata.audit)
    policy[name] = { execution: metadata.execution, audit: metadata.audit };
  const input = validateSchema(
    methodParams(method, where),
    `${where}.params`,
    refs,
  );
  const output = validateSchema(
    object(method["result"], `${where}.result`)["schema"],
    `${where}.result.schema`,
    refs,
  );
  return { name, input, output };
}

/** Generate reviewable artifacts from the bounded OpenRPC 1.3.2 / JSON Schema draft-07 profile. */
export function generateContract(document: unknown, source: string) {
  const doc = object(document, "OpenRPC document");
  if (doc["openrpc"] !== "1.3.2") fail("openrpc", "expected 1.3.2");
  const methods = list(doc["methods"], "methods");
  if (!methods.length) fail("methods", "expected nonempty array");
  const refs = schemaReferences(doc);
  const ajv = new Ajv({
    code: { source: true, esm: true },
    strict: true,
    ownProperties: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
  });
  const entries: string[] = [];
  const policy: Policy = {};
  const exports: Record<string, string> = {};
  const names = new Set<string>();
  methods.forEach((value, index) => {
    const { name, input, output } = parseMethod(
      value,
      index,
      refs,
      names,
      policy,
    );
    ajv.addSchema(input, `rpc-input-${index}`);
    ajv.addSchema(output, `rpc-output-${index}`);
    exports[`input${index}`] = `rpc-input-${index}`;
    exports[`output${index}`] = `rpc-output-${index}`;
    entries.push(
      `${JSON.stringify(name)}: { params: ${emitSchemaType(input)}; result: ${emitSchemaType(output)} };`,
    );
  });
  const code = compileValidators(ajv, exports);
  return {
    contract: contractTemplate(source, entries),
    validators: validatorsTemplate(source, code, [...names]),
    declarations: declarationsTemplate(source),
    policy: policyTemplate(source, policy),
  };
}
