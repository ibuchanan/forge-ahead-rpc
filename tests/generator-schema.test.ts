import { expect, test } from "bun:test";
import { emitSchemaType, validateSchema } from "../src/generator-schema";

test("validation resolves references and normalizes nested schemas independently of emission", () => {
  const schema = validateSchema(
    {
      type: "object",
      properties: { label: { $ref: "#/components/schemas/Label" } },
      required: ["label"],
      additionalProperties: false,
    },
    "result",
    new Map([["#/components/schemas/Label", { const: "ready" }]]),
  );
  expect(schema).toEqual({
    type: "object",
    properties: { label: { const: "ready", type: "string" } },
    required: ["label"],
    additionalProperties: false,
  });
  expect(emitSchemaType(schema)).toBe('{ "label": "ready" }');
});

test("TypeScript emission accepts a normalized schema independently of validation", () => {
  expect(
    emitSchemaType({
      type: "object",
      properties: {
        note: { type: ["string", "null"] },
        state: { type: "string", enum: ["new", "done"] },
      },
      required: ["state"],
      additionalProperties: false,
    }),
  ).toBe('{ "note"?: string | null; "state": "new" | "done" }');
});

test("validation rejects invalid schemas before TypeScript emission", () => {
  expect(() =>
    validateSchema({ type: "string", minLength: -1 }, "result", new Map()),
  ).toThrow("result: minLength must be nonnegative integer");
});
