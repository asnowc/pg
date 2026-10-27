import { DB_CONNECT_INFO } from "../utils/db.ts";
import { PoolHandler, PoolQueryTest, TestQueries } from "..//utils/common.ts";
import { PgSession } from "@/protocol.ts";
import { sqlStatementToSqlEncoder } from "@/implement/private/sql_statement.ts";
import { connectPgSession } from "@/protocol/connect.ts";

export const LIB_NAME = "调度模拟";

class Pool {
  constructor(readonly conn: PgSession[]) {
  }
  count = 0;
  async query(sql: string): Promise<any> {
    const conn = this.conn[this.count++ % this.conn.length];
    const encoder = sqlStatementToSqlEncoder(sql);
    const promise = conn.extendedQuery(encoder);
    conn.sync();
    return promise;
  }
  async close() {
    await Promise.all(this.conn.map((conn) => conn.close()));
  }
}
async function createPool(size: number) {
  const pool = new Array(size).fill(0).map(async () => {
    const conn = await Deno.connect({ hostname: DB_CONNECT_INFO.host, port: DB_CONNECT_INFO.port });
    return connectPgSession(conn, {
      database: DB_CONNECT_INFO.database,
      user: DB_CONNECT_INFO.user,
      password: DB_CONNECT_INFO.password,
    });
  });
  return new Pool(await Promise.all(pool));
}
export const poolInfo: PoolHandler<Pool> = {
  name: LIB_NAME,
  createPool: ({ poolSize }) => createPool(poolSize),
  closePool: (pool) => pool.close(),
};

const queries: TestQueries<Pool> = {
  select: async (client) => {
    await client.query("select 1 as x");
  },
  selectArg: async (client) => {
    await client.query("select 1 as x");
  },
  selectArgs: async (client) => {
    await client.query("select 1 as x");
  },
};

export const poolQueryTest: PoolQueryTest<Pool> = {
  ...queries,
  ...poolInfo,
};
