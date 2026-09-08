import { bench, describe } from "vitest";
import {} from "pg";
import {} from "pg-promise";
import {} from "postgres";

describe("select", () => {
  bench("pg", async () => {
  });
  bench("pg-promise", async () => {
  });
  bench("postgres", async () => {
  });
  bench("@asla/pg", async () => {
  });
});
describe("select_arg", () => {
});
describe("select_args", () => {
});
describe("select_where", () => {
});
