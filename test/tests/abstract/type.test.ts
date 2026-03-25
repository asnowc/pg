import type { InferQueryResult, SqlStatementDataset } from "#abstract";
import { expectTypeOf, test } from "vitest";

test("推断类型", function () {
  expectTypeOf<InferQueryResult<SqlStatementDataset<{ age: number }>>>().toEqualTypeOf<{ age: number }>();
});
