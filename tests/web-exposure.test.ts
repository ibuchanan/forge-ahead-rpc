import { expect, test } from "bun:test";
import { ok } from "@forge-ahead/errors";
import { generateContract } from "../src/generator";
import { createWebDispatcher } from "../src/index";

const ref = "#/components/schemas/Public";
const document = {
  openrpc: "1.3.2",
  info: { title: "Commands", version: "1.0.0", "x-secret": "hidden" },
  components: {
    schemas: {
      Public: { type: "string" },
      Internal: { type: "string" },
    },
  },
  methods: [
    {
      name: "public.one",
      paramStructure: "by-name",
      params: [{ name: "text", required: true, schema: { $ref: ref } }],
      result: { name: "value", schema: { $ref: ref } },
      "x-forge-ahead": { web: true, execution: "asUser", audit: "critical" },
    },
    {
      name: "public.two",
      paramStructure: "by-name",
      params: [],
      result: { name: "value", schema: { type: "boolean" } },
      "x-forge-ahead": { web: true, execution: "asApp", audit: "standard" },
    },
    {
      name: "private.one",
      paramStructure: "by-name",
      params: [],
      result: {
        name: "value",
        schema: { $ref: "#/components/schemas/Internal" },
      },
    },
  ],
};

const options = {
  catalog: document,
  webPolicy: {
    "public.one": { execution: "asUser" as const, audit: "critical" as const },
    "public.two": { execution: "asApp" as const, audit: "standard" as const },
  },
  handlers: {
    "public.one": async () => ok("done"),
    "public.two": async () => ok(true),
    "private.one": async () => ok("secret"),
  },
  inputValidators: {
    "public.one": () => true,
    "public.two": () => true,
    "private.one": () => true,
  },
  outputValidators: {
    "public.one": () => true,
    "public.two": () => true,
    "private.one": () => true,
  },
};
const request = (method: string) => ({
  jsonrpc: "2.0",
  id: 1,
  method,
  params: {},
});

test("reviewed metadata changes the checked-in generated policy", () => {
  const before = generateContract(document, "fixture.json").policy;
  const changed = {
    ...document,
    methods: [
      {
        ...document.methods[0],
        "x-forge-ahead": { web: false, execution: "asUser", audit: "critical" },
      },
      ...document.methods.slice(1),
    ],
  };
  expect(generateContract(changed, "fixture.json").policy).not.toEqual(before);
  expect(before).toContain('"public.one"');
  expect(before).not.toContain('"private.one"');
});

test("generation rejects invalid reviewed web metadata", () => {
  expect(() => generateContract(document, "fixture.json")).not.toThrow();
  for (const metadata of [
    { web: true },
    { web: "true", execution: "asApp", audit: "standard" },
    { web: true, execution: "asAdmin", audit: "standard" },
    { web: true, execution: "asUser", audit: "low" },
    { web: true, execution: "asUser", audit: "critical", extra: true },
  ]) {
    expect(() =>
      generateContract(
        {
          ...document,
          methods: [
            { ...document.methods[0], "x-forge-ahead": metadata },
            ...document.methods.slice(1),
          ],
        },
        "fixture.json",
      ),
    ).toThrow(/x-forge-ahead/);
  }
});

test("web views derive from one document and omit private material", async () => {
  const web = createWebDispatcher({
    ...options,
    selection: () => ({ "public.one": "asUser" as const }),
  });
  expect(
    (web.publicDocument["methods"] as { name: string }[]).map(
      (method: { name: string }) => method.name,
    ),
  ).toEqual(["public.one", "public.two"]);
  expect(
    (web.publicDocument["components"] as { schemas: unknown }).schemas,
  ).toEqual({
    Public: { type: "string" },
  });
  expect(JSON.stringify(web.publicDocument)).not.toMatch(
    /private|Internal|hidden|x-forge-ahead/,
  );
  const found = await web.dispatch(request("rpc.discover"), {});
  expect(found).toMatchObject({
    jsonrpc: "2.0",
    id: 1,
    result: { methods: [{ name: "public.one" }] },
  });
  expect(JSON.stringify(found)).not.toMatch(
    /public.two|private|Internal|hidden|x-forge-ahead/,
  );
});

test("runtime document cannot widen the generated maximum", () => {
  const drifted = {
    ...document,
    methods: document.methods.map((method) =>
      method.name === "private.one"
        ? {
            ...method,
            "x-forge-ahead": {
              web: true,
              execution: "asApp",
              audit: "standard",
            },
          }
        : method,
    ),
  };
  expect(() => createWebDispatcher({ ...options, catalog: drifted })).toThrow(
    /drift/,
  );
});

test("discovery follows changing trusted selection and excludes unroutable methods", async () => {
  let selected: Record<string, "asApp" | "asUser"> = {
    "public.one": "asUser",
    "public.two": "asApp",
  };
  let reads = 0;
  const web = createWebDispatcher({
    ...options,
    handlers: { "public.one": options.handlers["public.one"] },
    selection: () => {
      reads++;
      return selected;
    },
    authorize: () => true,
  });
  expect(await web.dispatch(request("rpc.discover"), {})).toMatchObject({
    result: { methods: [{ name: "public.one" }] },
  });
  expect(reads).toBe(1);
  selected = {};
  expect(await web.dispatch(request("public.one"), {})).toEqual({
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32601, message: "Method not found" },
  });
  expect(await web.dispatch(request("rpc.discover"), {})).toMatchObject({
    result: { methods: [] },
  });
});

test("reserved discovery name cannot become an application method", () => {
  expect(() =>
    createWebDispatcher({
      ...options,
      catalog: {
        ...document,
        methods: [{ ...document.methods[0], name: "rpc.discover" }],
      },
    }),
  ).toThrow(/reserved/);
  expect(() =>
    generateContract(
      {
        ...document,
        methods: [{ ...document.methods[0], name: "rpc.discover" }],
      },
      "fixture.json",
    ),
  ).toThrow(/reserved/);
});

test("selected asUser method needs an explicit Forge user-context check", async () => {
  let calls = 0;
  const web = createWebDispatcher({
    ...options,
    handlers: {
      ...options.handlers,
      "public.one": async () => {
        calls++;
        return ok("done");
      },
    },
    selection: () => ({ "public.one": "asUser", "public.two": "asApp" }),
    authorize: () => true,
  });
  expect(await web.dispatch(request("public.one"), {})).toEqual({
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32001, message: "Not permitted" },
  });
  expect(await web.dispatch(request("public.two"), {})).toEqual({
    jsonrpc: "2.0",
    id: 1,
    result: true,
  });
  expect(calls).toBe(0);
});

test("app-owned policy can deny a method for one installation but allow another", async () => {
  const web = createWebDispatcher({
    ...options,
    selection: () => ({ "public.two": "asApp" }),
    authorize: (_name, _mode, context: { installation: string }) =>
      context.installation === "enabled",
  });
  expect(
    await web.dispatch(request("public.two"), { installation: "disabled" }),
  ).toEqual({
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32001, message: "Not permitted" },
  });
  expect(
    await web.dispatch(request("public.two"), { installation: "enabled" }),
  ).toEqual({
    jsonrpc: "2.0",
    id: 1,
    result: true,
  });
});

test("Forge user-context failure denies without exposing the exception", async () => {
  let calls = 0;
  const web = createWebDispatcher({
    ...options,
    handlers: {
      ...options.handlers,
      "public.one": async () => {
        calls++;
        return ok("done");
      },
    },
    selection: () => ({ "public.one": "asUser" }),
    authorize: () => true,
    canActAsUser: async () => {
      throw new Error("private Forge detail");
    },
  });
  expect(await web.dispatch(request("public.one"), {})).toEqual({
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32001, message: "Not permitted" },
  });
  expect(calls).toBe(0);
});

test("selected, authorized method executes through the existing validators", async () => {
  let mode: string | undefined;
  const web = createWebDispatcher({
    ...options,
    selection: () => ({ "public.one": "asUser" }),
    canActAsUser: () => true,
    authorize: (_method, chosen) => {
      mode = chosen;
      return true;
    },
  });
  expect(await web.dispatch(request("public.one"), {})).toEqual({
    jsonrpc: "2.0",
    id: 1,
    result: "done",
  });
  expect(mode).toBe("asUser");
  expect(
    await web.dispatch({ ...request("rpc.discover"), params: [] }, {}),
  ).toEqual({
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32600, message: "Invalid request" },
  });
  expect(
    await web.dispatch(
      { ...request("rpc.discover"), params: { extra: true } },
      {},
    ),
  ).toEqual({
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32602, message: "Invalid params" },
  });
});

test("policy callback failures do not execute or leak exceptions", async () => {
  const web = createWebDispatcher({
    ...options,
    selection: () => ({ "public.one": "asUser" }),
    authorize: () => {
      throw new Error("private policy detail");
    },
  });
  expect(await web.dispatch(request("public.one"), {})).toEqual({
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32603, message: "Internal error" },
  });
});

test("selection narrows exposure and authorization without affecting internal dispatch", async () => {
  let calls = 0;
  const web = createWebDispatcher({
    ...options,
    handlers: {
      ...options.handlers,
      "public.one": async () => {
        calls++;
        return ok("done");
      },
    },
    selection: () => ({
      "public.one": "asUser" as const,
      "private.one": "asApp" as const,
      invented: "asApp" as const,
      "public.two": "asUser" as const,
    }),
    authorize: () => false,
  });
  expect(await web.dispatch(request("private.one"), {})).toEqual(
    await web.dispatch(request("invented"), {}),
  );
  expect(await web.dispatch(request("public.two"), {})).toEqual(
    await web.dispatch(request("invented"), {}),
  );
  expect(await web.dispatch(request("public.one"), {})).toEqual({
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32001, message: "Not permitted" },
  });
  expect(calls).toBe(0);
  expect(
    await createWebDispatcher({ ...options }).dispatch(
      request("rpc.discover"),
      {},
    ),
  ).toMatchObject({ result: { methods: [] } });
});
