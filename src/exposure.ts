import {
  type OpenRpcDocument,
  type OpenRpcSchema,
  schemaKeywords,
} from "./openrpc";

export type Mode = "asApp" | "asUser";
export type Metadata = {
  web?: boolean;
  execution?: Mode;
  audit?: "standard" | "critical";
};
/** Reject malformed reviewed method policy rather than weakening it silently. */
export function methodMetadata(method: {
  name?: unknown;
  "x-forge-ahead"?: unknown;
}): Metadata {
  const value = method["x-forge-ahead"];
  if (value === undefined) return {};
  function invalid(): never {
    throw new Error(
      `${String(method.name)}.x-forge-ahead: invalid reviewed metadata`,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  if (
    Object.keys(value).some(
      (key) => !["web", "execution", "audit"].includes(key),
    ) ||
    ("web" in value &&
      value.web !== undefined &&
      typeof value.web !== "boolean") ||
    ("execution" in value &&
      value.execution !== undefined &&
      value.execution !== "asApp" &&
      value.execution !== "asUser") ||
    ("audit" in value &&
      value.audit !== undefined &&
      value.audit !== "standard" &&
      value.audit !== "critical") ||
    ("web" in value &&
      value.web === true &&
      (!("execution" in value) ||
        !value.execution ||
        !("audit" in value) ||
        !value.audit))
  )
    invalid();
  return value;
}

/** Project selected methods and transitively referenced schemas; strip private metadata. */
export function webDocument(
  document: OpenRpcDocument,
  names: ReadonlySet<string>,
): OpenRpcDocument {
  const schemas = document.components?.schemas ?? {};
  const referencedSchema = (key: string): OpenRpcSchema => {
    const schema = schemas[key];
    if (!schema) throw new Error(`unresolved schema ${key}`);
    return schema;
  };
  const included = new Set<string>();
  const copySchema = (schema: OpenRpcSchema): OpenRpcSchema => {
    if (schema.$ref !== undefined) {
      const ref = schema.$ref;
      const key = ref.slice("#/components/schemas/".length);
      if (!included.has(key)) {
        included.add(key);
        copySchema(referencedSchema(key));
      }
      return { $ref: ref };
    }
    const result: OpenRpcSchema = {};
    for (const key of schemaKeywords) {
      if (key === "$ref" || key === "properties") continue;
      if (key in schema) Object.assign(result, { [key]: schema[key] });
    }
    if (schema.properties)
      result.properties = Object.fromEntries(
        Object.entries(schema.properties).map(([key, value]) => [
          key,
          copySchema(value),
        ]),
      );
    return result;
  };
  const methods = document.methods
    .filter((method) => names.has(method.name))
    .map((method) => ({
      name: method.name,
      ...(typeof method.summary === "string"
        ? { summary: method.summary }
        : {}),
      ...(typeof method.description === "string"
        ? { description: method.description }
        : {}),
      paramStructure: "by-name" as const,
      params: method.params.map((param) => ({
        name: param.name,
        ...(param.required === true ? { required: true } : {}),
        schema: copySchema(param.schema),
      })),
      result: {
        name: method.result.name,
        schema: copySchema(method.result.schema),
      },
    }));
  const view: OpenRpcDocument = {
    openrpc: document.openrpc,
    info: { title: document.info.title, version: document.info.version },
    methods,
  };
  if (included.size)
    view.components = {
      schemas: Object.fromEntries(
        [...included].map((key) => [key, copySchema(referencedSchema(key))]),
      ),
    };
  return view;
}
