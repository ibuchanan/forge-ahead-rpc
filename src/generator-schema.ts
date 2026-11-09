import type { OpenRpcSchema } from "./openrpc";
import { schemaKeywords } from "./openrpc";

type Obj = Record<string, unknown>;
const schemaKeys = new Set<string>(schemaKeywords);

export function fail(where: string, reason: string): never {
  throw new Error(`${where}: ${reason}`);
}
export function object(value: unknown, where: string): Obj {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : fail(where, "expected object");
}
export function list(value: unknown, where: string): unknown[] {
  return Array.isArray(value)
    ? (value as unknown[])
    : fail(where, "expected array");
}

function schemaKind(schema: Obj, where: string) {
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
  return {
    types,
    kind:
      (types.find((type) => type !== "null") as string | undefined) ?? "null",
  };
}

function validateLiterals(
  schema: Obj,
  kind: string,
  types: unknown[],
  where: string,
) {
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
}

function validateLimits(schema: Obj, kind: string, where: string) {
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
}

function validateObject(
  schema: Obj,
  types: unknown[],
  where: string,
  refs: Map<string, Obj>,
  stack: string[],
): OpenRpcSchema {
  if (
    types.length !== 1 ||
    "const" in schema ||
    schema["enum"] !== undefined ||
    schema["additionalProperties"] !== false
  )
    fail(
      where,
      "object requires additionalProperties: false and no unions or literals",
    );
  const properties = object(schema["properties"] ?? {}, `${where}.properties`);
  const required = list(schema["required"] ?? [], `${where}.required`);
  if (
    new Set(required).size !== required.length ||
    required.some(
      (key) => typeof key !== "string" || !Object.hasOwn(properties, key),
    )
  )
    fail(where, "required must list unique declared properties");
  const props: Record<string, OpenRpcSchema> = {};
  for (const [key, item] of Object.entries(properties))
    props[key] = validateSchema(
      item,
      `${where}.properties.${key}`,
      refs,
      stack,
    );
  return { ...schema, properties: props } as OpenRpcSchema;
}

/** Validate and normalize a schema without emitting TypeScript. */
export function validateSchema(
  value: unknown,
  where: string,
  refs: Map<string, Obj>,
  stack: string[] = [],
): OpenRpcSchema {
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
    return validateSchema(refs.get(ref), ref, refs, [...stack, ref]);
  }
  const { kind, types } = schemaKind(schema, where);
  validateLiterals(schema, kind, types, where);
  validateLimits(schema, kind, where);
  if (
    kind !== "object" &&
    ["properties", "required", "additionalProperties"].some(
      (key) => key in schema,
    )
  )
    fail(where, "object keywords require object type");
  if (kind === "object")
    return validateObject(schema, types, where, refs, stack);
  return (
    schema["type"] === undefined ? { ...schema, type: kind } : { ...schema }
  ) as OpenRpcSchema;
}

/** Emit TypeScript from a previously validated, normalized schema. */
export function emitSchemaType(schema: OpenRpcSchema): string {
  if (schema.type === "object") {
    const properties = schema.properties ?? {};
    return Object.keys(properties).length === 0
      ? "Record<string, never>"
      : `{ ${Object.entries(properties)
          .map(
            ([key, item]) =>
              `${JSON.stringify(key)}${schema.required?.includes(key) ? "" : "?"}: ${emitSchemaType(item)}`,
          )
          .join("; ")} }`;
  }
  const kind = Array.isArray(schema.type)
    ? (schema.type.find((type) => type !== "null") ?? "null")
    : schema.type;
  let ts =
    "const" in schema
      ? JSON.stringify(schema.const)
      : Array.isArray(schema.enum)
        ? schema.enum.map((item) => JSON.stringify(item)).join(" | ")
        : (kind as string);
  if (Array.isArray(schema.type) && schema.type.length === 2) ts += " | null";
  return ts;
}
