/** Keywords supported by the bounded draft-07 schema profile. */
export const schemaKeywords = [
  "$ref",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "const",
  "enum",
  "minLength",
  "maxLength",
] as const;

export type OpenRpcSchema = {
  $ref?: string;
  type?: string | readonly string[];
  properties?: Record<string, OpenRpcSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  const?: string | boolean | null;
  enum?: readonly (string | boolean)[];
  minLength?: number;
  maxLength?: number;
};

/** Static JSON metadata; not a JSON Schema or executable error definition. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type OpenRpcError = {
  code: number;
  message: string;
  data?: JsonValue;
};

export type OpenRpcMethod = {
  name: string;
  summary?: string;
  description?: string;
  paramStructure?: string;
  params: { name: string; required?: boolean; schema: OpenRpcSchema }[];
  result: { name: string; schema: OpenRpcSchema };
  errors?: OpenRpcError[];
  "x-retryable-errors"?: number[];
  "x-forge-ahead"?: unknown;
};

/** The bounded OpenRPC 1.3.2 profile accepted by the generator and web catalog. */
export type OpenRpcDocument = {
  openrpc: string;
  info: { title: string; version: string };
  methods: OpenRpcMethod[];
  components?: { schemas?: Record<string, OpenRpcSchema> };
};
