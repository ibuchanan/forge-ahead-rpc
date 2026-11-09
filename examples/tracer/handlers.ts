import { ok } from "@forge-ahead/errors";
import type { HandlerMap } from "./generated/contract";

export const handlers = {
  "greeting.hello": async ({ name }, context) =>
    ok({ message: `${context.prefix}, ${name}!` }),
  "greeting.ping": async () => ok(true),
} satisfies HandlerMap<{ prefix: string }, string>;
