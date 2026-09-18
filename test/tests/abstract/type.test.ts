import type { SqlStatementDataset } from "#abstract";
import type { InferQueryResult } from "@asla/pg";
import { expectTypeOf, test } from "vitest";

test("推断类型", function () {
  expectTypeOf<InferQueryResult<SqlStatementDataset<{ age: number }>>>().toEqualTypeOf<{ age: number }>();
});
