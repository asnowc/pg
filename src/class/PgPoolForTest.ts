import type { PgPool } from "./PgPool.ts";
import { PoolPgSession } from "@/class/Pool.ts";

function noImpl(...args: any[]): never {
  throw new Error("Not implemented");
}
export const poolForTest: {
  getPooInternalPool: (pool: PgPool) => {
    pool: Set<PoolPgSession>;
    idle: Set<PoolPgSession>;
    inPipeline: Set<PoolPgSession>;
  };
} = {
  getPooInternalPool: noImpl,
};
