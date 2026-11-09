import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { ok } from "@forge-ahead/errors";
import {
  createDispatcher,
  createTestProfileSelection,
  createWebDispatcher,
} from "../src/index";
import { createJiraAdminAuthenticator } from "../examples/tracer/jira-admin-authenticator";

const catalog = {
  openrpc: "1.3.2",
  info: { title: "Test commands", version: "1" },
  methods: [
    {
      name: "first",
      params: [],
      result: { name: "value", schema: { type: "string" } },
      "x-forge-ahead": { web: true, execution: "asUser", audit: "standard" },
    },
    {
      name: "second",
      params: [],
      result: { name: "value", schema: { type: "string" } },
      "x-forge-ahead": { web: true, execution: "asApp", audit: "standard" },
    },
    {
      name: "internal",
      params: [],
      result: { name: "value", schema: { type: "string" } },
    },
  ],
};
const webPolicy = {
  first: { execution: "asUser" as const, audit: "standard" as const },
  second: { execution: "asApp" as const, audit: "standard" as const },
};
type Context = {
  principal: { accountId: string };
  installation: { jiraSiteUrl: string; allMethods: boolean };
};
const handlers = Object.fromEntries(
  catalog.methods.map(({ name }) => [
    name,
    async (_: never, context: Context) =>
      ok(`${name}:${context.principal.accountId}`),
  ]),
);
const validators = Object.fromEntries(
  catalog.methods.map(({ name }) => [name, () => true]),
);
const shared = {
  catalog,
  webPolicy,
  handlers,
  inputValidators: validators,
  outputValidators: validators,
};
const call = (method: string) => ({
  jsonrpc: "2.0",
  id: 1,
  method,
  params: {},
});
const principal = { accountId: "trusted-test-account" };
const installation = {
  jiraSiteUrl: "https://trusted.atlassian.net",
  allMethods: true,
};
const trusted = { principal, installation };

test("all specified commands run in memory with an explicitly trusted test principal", async () => {
  const dispatch = createDispatcher(shared);
  for (const { name } of catalog.methods) {
    expect(await dispatch(call(name), trusted)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: `${name}:trusted-test-account`,
    });
  }
});

test("development selects reviewed web methods, while production keeps its trusted subset", async () => {
  const production = () => ({ second: "asApp" as const });
  for (const [build, expected] of [
    ["development", ["second"]],
    ["production", ["second"]],
  ] as const) {
    const web = createWebDispatcher({
      ...shared,
      selection: createTestProfileSelection(webPolicy, build, production),
      authorize: () => true,
      canActAsUser: () => true,
    });
    expect(
      (
        (await web.dispatch(call("rpc.discover"), trusted)) as {
          result: { methods: { name: string }[] };
        }
      ).result.methods.map(({ name }) => name),
    ).toEqual([...expected]);
    expect(await web.dispatch(call("internal"), trusted)).toMatchObject({
      error: { code: -32601 },
    });
    expect(await web.dispatch(call("first"), trusted)).toMatchObject({
      error: { code: -32601 },
    });
  }
  expect(
    (
      (await createWebDispatcher({ ...shared }).dispatch(
        call("rpc.discover"),
        trusted,
      )) as { result: { methods: unknown[] } }
    ).result.methods,
  ).toEqual([]);
});

test("compiled production and development builds cannot be switched by runtime installation settings", async () => {
  if (!process.env["RPC_CHECK_BUILDS"]) return;
  expect(existsSync("dist/index.mjs")).toBe(true);
  expect(existsSync("dist-development/index.mjs")).toBe(true);
  const productionPath = "../dist/index.mjs";
  const developmentPath = "../dist-development/index.mjs";
  const { createTestProfileSelection: production } = await import(
    productionPath
  );
  const { createTestProfileSelection: development } = await import(
    developmentPath
  );
  const ordinary = () => ({ second: "asApp" as const });
  expect(production(webPolicy, "development", ordinary)(trusted)).toEqual({
    second: "asApp",
  });
  expect(development(webPolicy, "development", ordinary)(trusted)).toEqual({
    first: "asUser",
    second: "asApp",
  });
  expect(development(webPolicy, "production", ordinary)(trusted)).toEqual({
    second: "asApp",
  });
});

test("development webtrigger authenticates every call and preserves declared execution modes", async () => {
  const urls: string[] = [];
  const modes: string[] = [];
  let canAct = false;
  const authorization = `Basic ${Buffer.from("user@example.test:token").toString("base64")}`;
  if (!process.env["RPC_CHECK_BUILDS"]) return;
  const developmentPath = "../dist-development/webtrigger.mjs";
  const developmentIndex = "../dist-development/index.mjs";
  const { createWebtrigger: developmentWebtrigger } = (await import(
    developmentPath
  )) as typeof import("../src/webtrigger");
  const { createTestProfileSelection: developmentSelection } = (await import(
    developmentIndex
  )) as typeof import("../src/index");
  const handle = developmentWebtrigger({
    ...shared,
    installation: (forge: { installation: typeof installation }) =>
      forge.installation,
    authenticate: createJiraAdminAuthenticator(async (url) => {
      urls.push(url);
      return url.endsWith("/myself")
        ? { status: 200, body: { accountId: "jira-verified" } }
        : {
            status: 200,
            body: { permissions: { ADMINISTER: { havePermission: true } } },
          };
    }),
    context: (site, verified: { accountId: string }): Context => ({
      installation: site,
      principal: verified,
    }),
    selection: developmentSelection(webPolicy, "development", () => ({})),
    authorize: (_method, mode) => {
      modes.push(mode);
      return true;
    },
    canActAsUser: () => canAct,
  });
  const invoke = (method: string, credential = authorization) =>
    handle(
      {
        method: "POST",
        headers: {
          "Content-Type": ["application/json"],
          Authorization: [credential],
        },
        body: JSON.stringify(call(method)),
      },
      { installation },
    );
  expect((await invoke("first", "Bearer invalid")).statusCode).toBe(401);
  expect(urls).toEqual([]);
  expect(JSON.parse((await invoke("first")).body)).toMatchObject({
    error: { code: -32001 },
  });
  canAct = true;
  expect(JSON.parse((await invoke("first")).body)).toMatchObject({
    result: "first:jira-verified",
  });
  expect(JSON.parse((await invoke("second")).body)).toMatchObject({
    result: "second:jira-verified",
  });
  expect(JSON.parse((await invoke("internal")).body)).toMatchObject({
    error: { code: -32601 },
  });
  expect(
    JSON.parse((await invoke("rpc.discover")).body).result.methods.map(
      ({ name }: { name: string }) => name,
    ),
  ).toEqual(["first", "second"]);
  expect(urls).toHaveLength(10);
  expect(modes).toEqual(["asUser", "asUser", "asApp"]);
});
