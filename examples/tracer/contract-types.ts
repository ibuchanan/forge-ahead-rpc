import type { Caller, HandlerMap } from "./generated/contract";
import { ok } from "@forge-ahead/errors";

const valid = {
  "greeting.hello": async ({ name }) => ok({ message: name }),
  "greeting.ping": async () => ok(true),
} satisfies HandlerMap<object, string>;
void valid;

// @ts-expect-error generated contracts require all handlers
const incomplete: HandlerMap<object, string> = {
  "greeting.hello": async () => ok({ message: "Hello" }),
};
void incomplete;

declare const call: Caller;
void call("greeting.hello", { name: "Ada" });
// @ts-expect-error generated named parameters reject wrong types
void call("greeting.hello", { name: 42 });
// @ts-expect-error generated catalog rejects unknown methods
void call("greeting.unknown", {});
