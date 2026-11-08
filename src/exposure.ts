export type Mode = "asApp" | "asUser";
export type Metadata = {
  web?: boolean;
  execution?: Mode;
  audit?: "standard" | "critical";
};
type Item = Record<string, unknown>;

/** Reject malformed reviewed method policy rather than weakening it silently. */
export function methodMetadata(method: Item): Metadata {
  const value = method["x-forge-ahead"];
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      `${String(method["name"])}.x-forge-ahead: invalid reviewed metadata`,
    );
  const meta = value as Item;
  if (
    Object.keys(meta).some(
      (key) => !["web", "execution", "audit"].includes(key),
    ) ||
    (meta["web"] !== undefined && typeof meta["web"] !== "boolean") ||
    (meta["execution"] !== undefined &&
      !["asApp", "asUser"].includes(meta["execution"] as string)) ||
    (meta["audit"] !== undefined &&
      !["standard", "critical"].includes(meta["audit"] as string)) ||
    (meta["web"] === true && (!meta["execution"] || !meta["audit"]))
  )
    throw new Error(
      `${String(method["name"])}.x-forge-ahead: invalid reviewed metadata`,
    );
  return meta as Metadata;
}

/** Project selected methods and transitively referenced schemas; strip private metadata. */
export function webDocument(document: Item, names: ReadonlySet<string>): Item {
  const components = document["components"] as Item | undefined;
  const schemas = (components?.["schemas"] as Item | undefined) ?? {};
  const included = new Set<string>();
  const copySchema = (schema: Item): Item => {
    if (typeof schema["$ref"] === "string") {
      const ref = schema["$ref"];
      const key = ref.slice("#/components/schemas/".length);
      if (!included.has(key)) {
        included.add(key);
        copySchema(schemas[key] as Item);
      }
      return { $ref: ref };
    }
    const result: Item = {};
    for (const key of [
      "type",
      "required",
      "additionalProperties",
      "const",
      "enum",
      "minLength",
      "maxLength",
    ])
      if (key in schema) result[key] = schema[key];
    if (schema["properties"])
      result["properties"] = Object.fromEntries(
        Object.entries(schema["properties"] as Item).map(([key, value]) => [
          key,
          copySchema(value as Item),
        ]),
      );
    return result;
  };
  const methods = (document["methods"] as Item[])
    .filter((method) => names.has(method["name"] as string))
    .map((method) => ({
      name: method["name"],
      ...(typeof method["summary"] === "string"
        ? { summary: method["summary"] }
        : {}),
      ...(typeof method["description"] === "string"
        ? { description: method["description"] }
        : {}),
      paramStructure: "by-name",
      params: (method["params"] as Item[]).map((param) => ({
        name: param["name"],
        ...(param["required"] === true ? { required: true } : {}),
        schema: copySchema(param["schema"] as Item),
      })),
      result: {
        name: (method["result"] as Item)["name"],
        schema: copySchema((method["result"] as Item)["schema"] as Item),
      },
    }));
  const info = document["info"] as Item;
  const view: Item = {
    openrpc: document["openrpc"],
    info: { title: info["title"], version: info["version"] },
    methods,
  };
  if (included.size)
    view["components"] = {
      schemas: Object.fromEntries(
        [...included].map((key) => [key, copySchema(schemas[key] as Item)]),
      ),
    };
  return view;
}
