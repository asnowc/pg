import { PgSession } from "@/protocol.ts";
import type { PgPool } from "./PgPool.ts";

function noImpl(...args: any[]): never {
  throw new Error("Not implemented");
}
export const poolForTest: {
  getPooInternalPool: (pool: PgPool) => {
    pool: Set<PgSession>;
    idle: Map<PgSession, number>;
    inPipeline: Set<PgSession>;
  };
} = {
  getPooInternalPool: noImpl,
};
