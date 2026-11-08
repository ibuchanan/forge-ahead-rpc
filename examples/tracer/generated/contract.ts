// Generated from openrpc.json; do not edit.
import type { Result } from "neverthrow";

export interface Commands {
  "greeting.hello": { params: { "name": string }; result: { "message": string } };
  "greeting.ping": { params: Record<string, never>; result: boolean };
}
export type HandlerMap<Context, Failure> = {
  [M in keyof Commands]: (params: Commands[M]["params"], context: Context) => Promise<Result<Commands[M]["result"], Failure>>;
};
export type Caller = <M extends keyof Commands>(method: M, params: Commands[M]["params"]) => Promise<Commands[M]["result"]>;
