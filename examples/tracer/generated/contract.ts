// Generated from examples/tracer/openrpc.json; do not edit.
import type { Result } from "neverthrow";

export interface Commands {
  "greeting.hello": { params: { name: string }; result: { message: string } };
}
export type HandlerMap<Context, Failure> = {
  [M in keyof Commands]: (
    params: Commands[M]["params"],
    context: Context,
  ) => Promise<Result<Commands[M]["result"], Failure>>;
};
