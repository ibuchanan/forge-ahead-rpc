import { ok } from "neverthrow";
import type { Caller, HandlerMap } from "../examples/tracer/generated/contract";

const handlers = {
  "greeting.hello": async ({ name }) => ok({ message: name }),
  "greeting.ping": async () => ok(true),
} satisfies HandlerMap<object, string>;
void handlers;

// @ts-expect-error the generated catalog requires every method
const incomplete: HandlerMap<object, string> = {
  "greeting.hello": async () => ok({ message: "hi" }),
};
void incomplete;

const incorrect: HandlerMap<object, string> = {
  // @ts-expect-error result type is derived from the OpenRPC schema
  "greeting.hello": async () => ok({ message: 42 }),
  "greeting.ping": async () => ok(true),
};
void incorrect;

declare const call: Caller;
void call("greeting.hello", { name: "Ada" });
void call("greeting.ping", {});
// @ts-expect-error empty named params reject unknown fields
void call("greeting.ping", { extra: true });
// @ts-expect-error wrong named param type
void call("greeting.hello", { name: 42 });
// @ts-expect-error unknown method
void call("greeting.unknown", {});
