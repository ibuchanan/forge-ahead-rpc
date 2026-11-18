import { expect, test } from "bun:test";
import { ok } from "@forge-ahead/errors";
import Ajv from "ajv";
import { generateContract } from "../src/generator";
import { createWebDispatcher, type OpenRpcDocument } from "../src/index";
import jsonSchema from "./fixtures/json-schema-tools.schema.json";
import metaSchema from "./fixtures/openrpc-1.3.2.schema.json";

const errors = [
  { code: -32602, message: "Invalid input" },
  {
    code: -32004,
    message: "Field unreadable",
    data: { type: "not a schema", nested: [null, true, 1.5, "public"] },
  },
];
const catalog: OpenRpcDocument = {
  openrpc: "1.3.2",
  info: { title: "Discovery metadata", version: "1" },
  methods: [
    {
      name: "export.document",
      paramStructure: "by-name",
      params: [],
      result: { name: "document", schema: { type: "string" } },
      errors,
      "x-forge-ahead": { web: true, execution: "asApp", audit: "standard" },
    },
  ],
};
const options = {
  catalog,
  webPolicy: {
    "export.document": {
      execution: "asApp" as const,
      audit: "standard" as const,
    },
  },
  handlers: { "export.document": async () => ok("document") },
  inputValidators: { "export.document": () => true },
  outputValidators: { "export.document": () => true },
  selection: () => ({ "export.document": "asApp" as const }),
};
const discover = { jsonrpc: "2.0", id: 1, method: "rpc.discover", params: {} };

test("public discovery preserves author-declared inline errors and static JSON data", async () => {
  const web = createWebDispatcher(options);
  const expected = {
    ...catalog,
    methods: [
      {
        name: "export.document",
        paramStructure: "by-name",
        params: [],
        result: { name: "document", schema: { type: "string" } },
        errors,
      },
    ],
  };
  expect(web.publicDocument).toEqual(expected);
  expect(await web.dispatch(discover, {})).toEqual({
    jsonrpc: "2.0",
    id: 1,
    result: expected,
  });
});

const cycle: Record<string, unknown> = {};
cycle["self"] = cycle;
const invalidErrors: unknown[] = [
  null,
  {},
  [null],
  [{ code: "-32004", message: "bad" }],
  [{ code: 1.5, message: "bad" }],
  [{ code: Infinity, message: "bad" }],
  [{ code: -32004 }],
  [{ code: -32004, message: 1 }],
  [errors[0], errors[0]],
  [{ $ref: "#/components/errors/Failure" }],
  ...[
    undefined,
    NaN,
    Infinity,
    1n,
    () => null,
    Symbol("private"),
    new Date(),
    new Map(),
    cycle,
    Array(2),
  ].map((data) => [{ code: -32004, message: "bad", data }]),
];
function withMetadata(metadata: Record<string, unknown>): OpenRpcDocument {
  return {
    ...catalog,
    methods: catalog.methods.map((method) => ({ ...method, ...metadata })),
  } as OpenRpcDocument;
}

test("generation rejects malformed inline errors with method and field diagnostics", () => {
  for (const value of invalidErrors) {
    expect(() =>
      generateContract(withMetadata({ errors: value }), "fixture.json"),
    ).toThrow(/export\.document\.errors/);
  }
  expect(() => generateContract(catalog, "fixture.json")).not.toThrow();
});

test("dispatcher construction rejects the same malformed errors even on hidden methods", () => {
  for (const value of invalidErrors) {
    const invalid = withMetadata({ errors: value, "x-forge-ahead": undefined });
    expect(() =>
      createWebDispatcher({ ...options, catalog: invalid, webPolicy: {} }),
    ).toThrow(/export\.document\.errors/);
  }
});

test("discovery allowlists inline error fields rather than publishing arbitrary properties", () => {
  const web = createWebDispatcher({
    ...options,
    catalog: withMetadata({
      errors: [
        { code: -32004, message: "Public", data: null, "x-private": "secret" },
      ],
      "x-unknown": "secret",
    }),
  });
  expect(web.publicDocument.methods[0]).toEqual({
    name: "export.document",
    paramStructure: "by-name",
    params: [],
    result: { name: "document", schema: { type: "string" } },
    errors: [{ code: -32004, message: "Public", data: null }],
  });
});

test("retry classification survives both discovery views without changing omission or empty lists", async () => {
  for (const retry of [[-32004], []]) {
    const web = createWebDispatcher({
      ...options,
      catalog: withMetadata({ "x-retryable-errors": retry }),
    });
    expect(web.publicDocument.methods[0]?.["x-retryable-errors"]).toEqual(
      retry,
    );
    expect(await web.dispatch(discover, {})).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: web.publicDocument,
    });
  }
  expect(
    createWebDispatcher(options).publicDocument.methods[0],
  ).not.toHaveProperty("x-retryable-errors");
});

const invalidRetries: unknown[] = [
  null,
  undefined,
  {},
  "-32004",
  [-32004, -32004],
  [-32005],
  [1.5],
  ["-32004"],
  [NaN],
  [Infinity],
  Array(1),
];
test("generation rejects invalid retry classification with method and field diagnostics", () => {
  for (const retry of invalidRetries) {
    expect(() =>
      generateContract(
        withMetadata({ "x-retryable-errors": retry }),
        "fixture.json",
      ),
    ).toThrow(/export\.document\.x-retryable-errors/);
  }
  expect(() =>
    generateContract(
      withMetadata({ errors: undefined, "x-retryable-errors": [-32004] }),
      "fixture.json",
    ),
  ).toThrow();
  for (const retry of [[], [-32004, -32602]]) {
    expect(
      generateContract(
        withMetadata({ "x-retryable-errors": retry }),
        "fixture.json",
      ),
    ).toEqual(generateContract(catalog, "fixture.json"));
  }
});

test("construction and generation agree on retry validation including undeclared codes", () => {
  for (const retry of invalidRetries) {
    expect(() =>
      createWebDispatcher({
        ...options,
        catalog: withMetadata({ "x-retryable-errors": retry }),
      }),
    ).toThrow(/export\.document\.x-retryable-errors/);
  }
  const noErrors = structuredClone(catalog);
  delete noErrors.methods[0]?.errors;
  for (const retry of [[-32004], []]) {
    const doc = {
      ...noErrors,
      methods: noErrors.methods.map((method) => ({
        ...method,
        "x-retryable-errors": retry,
      })),
    };
    if (retry.length) {
      expect(() => generateContract(doc, "fixture.json")).toThrow(
        /x-retryable-errors/,
      );
      expect(() => createWebDispatcher({ ...options, catalog: doc })).toThrow(
        /x-retryable-errors/,
      );
    } else {
      expect(() => generateContract(doc, "fixture.json")).not.toThrow();
      expect(
        createWebDispatcher({ ...options, catalog: doc }).publicDocument
          .methods[0]?.["x-retryable-errors"],
      ).toEqual([]);
    }
  }
});

test("metadata remains isolated across context selection and mutable discovery results", async () => {
  const original = withMetadata({ "x-retryable-errors": [-32004] });
  const before = structuredClone(original);
  const web = createWebDispatcher({
    ...options,
    catalog: original,
    selection: (context: { visible: boolean }) =>
      context.visible ? { "export.document": "asApp" as const } : {},
  });
  const first = await web.dispatch(discover, { visible: true });
  expect(first).toEqual({ jsonrpc: "2.0", id: 1, result: web.publicDocument });
  if (first && !Array.isArray(first) && "result" in first) {
    const doc = first.result as OpenRpcDocument;
    doc.methods[0]?.errors?.push({ code: 42, message: "tampered" });
    doc.methods[0]?.["x-retryable-errors"]?.push(42);
  }
  expect(await web.dispatch(discover, { visible: false })).toEqual({
    jsonrpc: "2.0",
    id: 1,
    result: { ...catalog, methods: [] },
  });
  expect(await web.dispatch(discover, { visible: true })).toEqual({
    jsonrpc: "2.0",
    id: 1,
    result: web.publicDocument,
  });
  expect(original).toEqual(before);
});

test("omitted errors stay omitted, explicit empty errors stay empty, generation stays unchanged", () => {
  const omitted = structuredClone(catalog);
  delete omitted.methods[0]?.errors;
  const empty = withMetadata({ errors: [] });
  expect(
    createWebDispatcher({ ...options, catalog: omitted }).publicDocument
      .methods[0],
  ).not.toHaveProperty("errors");
  expect(
    createWebDispatcher({ ...options, catalog: empty }).publicDocument
      .methods[0]?.errors,
  ).toEqual([]);
  expect(generateContract(catalog, "fixture.json")).toEqual(
    generateContract(omitted, "fixture.json"),
  );
});

test("source and discovered documents satisfy the standard OpenRPC 1.3.2 meta-schema", async () => {
  // The released schema declares a custom meta-meta-schema; Ajv validates the
  // document with its draft-07-compatible keywords without fetching that URL.
  const ajv = new Ajv({
    strict: false,
    validateFormats: false,
    validateSchema: false,
  });
  ajv.addSchema(jsonSchema);
  ajv.addSchema(jsonSchema, "https://meta.json-schema.tools");
  const validate = ajv.compile(metaSchema);
  const document = withMetadata({ "x-retryable-errors": [-32004] });
  const web = createWebDispatcher({ ...options, catalog: document });
  expect(validate(document) ? null : validate.errors).toBeNull();
  expect(validate(web.publicDocument)).toBe(true);
  const response = await web.dispatch(discover, {});
  expect(
    response &&
      !Array.isArray(response) &&
      "result" in response &&
      validate(response.result),
  ).toBe(true);
});

test("retry metadata never repeats a handler or bypasses authorization", async () => {
  let calls = 0;
  const web = createWebDispatcher({
    ...options,
    catalog: withMetadata({ "x-retryable-errors": [-32004] }),
    authorize: (_method, _params, context: { allow: boolean }) => context.allow,
    handlers: {
      "export.document": async () => {
        calls++;
        return ok("document");
      },
    },
  });
  const request = { ...discover, method: "export.document" };
  expect(await web.dispatch(request, { allow: true })).toEqual({
    jsonrpc: "2.0",
    id: 1,
    result: "document",
  });
  expect(calls).toBe(1);
  const denied = await web.dispatch(request, { allow: false });
  expect(denied).toHaveProperty("error");
  expect(calls).toBe(1);
});

test("metadata follows existing maximum exposure and per-context execution mode filtering", async () => {
  const method = catalog.methods[0];
  if (!method) throw new Error("Missing catalog fixture method");
  const names = [
    "allowed",
    "hidden",
    "unselected",
    "mismatch",
    "noHandler",
    "noInput",
    "noOutput",
  ];
  const document = {
    ...catalog,
    methods: names.map((name) => ({
      ...method,
      name,
      "x-forge-ahead": name === "hidden" ? undefined : method["x-forge-ahead"],
    })),
  };
  const policy = { execution: "asApp" as const, audit: "standard" as const };
  const web = createWebDispatcher({
    catalog: document,
    webPolicy: Object.fromEntries(
      names.filter((name) => name !== "hidden").map((name) => [name, policy]),
    ),
    handlers: Object.fromEntries(
      names
        .filter((name) => name !== "noHandler")
        .map((name) => [name, async () => ok("document")]),
    ),
    inputValidators: Object.fromEntries(
      names
        .filter((name) => name !== "noInput")
        .map((name) => [name, () => true]),
    ),
    outputValidators: Object.fromEntries(
      names
        .filter((name) => name !== "noOutput")
        .map((name) => [name, () => true]),
    ),
    selection: () => ({
      allowed: "asApp",
      mismatch: "asUser",
      hidden: "asApp",
      noHandler: "asApp",
      noInput: "asApp",
      noOutput: "asApp",
    }),
  });
  expect(web.publicDocument.methods.map((method) => method.name)).toEqual([
    "allowed",
    "unselected",
    "mismatch",
  ]);
  expect(await web.dispatch(discover, {})).toEqual({
    jsonrpc: "2.0",
    id: 1,
    result: {
      ...catalog,
      methods: [
        {
          name: "allowed",
          paramStructure: "by-name",
          params: [],
          result: method.result,
          errors,
        },
      ],
    },
  });
});
