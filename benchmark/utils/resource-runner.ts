import { PoolQueryTest } from "./common.ts";

export const libraries = ["@asla/pg-node", "postgres", "@asla/pg", "fake2", "pg", "pg-promise", "slonik"] as const;
export function loadLibrary(name: string): Promise<PoolQueryTest<any>> {
  switch (name) {
    case "postgres":
      return import("../client/postgres.ts").then((mod) => mod.poolQueryTest);
    case "fake2":
      return import("../client/fake2.ts").then((mod) => mod.poolQueryTest);
    case "@asla/pg": {
      return import("./init-asla-pg-test.ts").then(
        async ({ initTest }) => initTest(await import("@asla/pg")).poolQueryTest,
      );
    }
    case "@asla/pg-node": {
      return import("./init-asla-pg-test.ts").then(
        async ({ initTest }) => initTest(await import("@asla/pg-prev")).poolQueryTest,
      );
    }
    case "pg": {
      return import("../client/pg.ts").then((mod) => mod.poolQueryTest);
    }
    case "pg-promise": {
      return import("../client/pgPromise.ts").then((mod) => mod.poolQueryTest);
    }
    case "slonik": {
      return import("../client/slonik.ts").then((mod) => mod.poolQueryTest);
    }
    default:
      throw new Error(`Unknown benchmark library: ${name}`);
  }
}

export type Library = typeof libraries[number];
export function integer(minimum: number) {
  return (value: string) => {
    const number = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < minimum) {
      throw new Error(`Expected a integer >= ${minimum}, received ${JSON.stringify(value)}`);
    }
    return number;
  };
}

export function filename(name: string): string {
  return name.replace(/^@/, "").replace(/[\\/]/g, "-");
}
