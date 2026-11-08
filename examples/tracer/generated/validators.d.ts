// Generated from openrpc.json; do not edit.
import type { Commands } from "./contract";
type Validate<T> = (value: unknown) => value is T;
export const inputValidators: { [M in keyof Commands]: Validate<Commands[M]["params"]> };
export const outputValidators: { [M in keyof Commands]: Validate<Commands[M]["result"]> };
