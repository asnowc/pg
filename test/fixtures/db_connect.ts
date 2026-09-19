import { test as viTest } from "vitest";
import { DbManage, type DbQueryPool, type PgConnection, PgDbQueryPool, PgPool } from "@asla/pg";
import process from "node:process";
import { DB_CONNECT_INFO, PUBLIC_DB_CONNECT_INFO } from "@test/utils/db.ts";
import { denoConnect } from "@test/utils/connect.ts";

export interface BaseContext {
  emptyDbPool: DbQueryPool;
  connect: PgConnection;
  pgPool: PgPool;
}
const VITEST_WORKER_ID = +process.env.VITEST_WORKER_ID!;
let databaseSequence = 0;

export const test = viTest.extend<BaseContext>({
  async emptyDbPool({}, use) {
    const databaseName = `test_empty_${VITEST_WORKER_ID}_${databaseSequence++}`;
    const manage = await getManage();
    try {
      await manage.recreateDb(databaseName);
    } finally {
      await manage.close();
    }
    const dbPool = new PgDbQueryPool({ ...DB_CONNECT_INFO, database: databaseName });

    dbPool.open();
    try {
      await use(dbPool);
    } finally {
      const useCount = dbPool.totalCount - dbPool.idleCount;
      await dbPool.close(true);
      await clearDropDb(databaseName);
      if (useCount !== 0) throw new Error("存在未释放的连接");
    }
  },
  async connect({}, use) {
    await using connection = await denoConnect(PUBLIC_DB_CONNECT_INFO);
    await use(connection);
  },
  async pgPool({}, use) {
    await using dbPool = new PgPool({
      create: () => Deno.connect({ hostname: PUBLIC_DB_CONNECT_INFO.hostname, port: PUBLIC_DB_CONNECT_INFO.port }),
      idleTimeout: 10,
      maxCount: 4,
      connect: {
        user: PUBLIC_DB_CONNECT_INFO.user,
        database: PUBLIC_DB_CONNECT_INFO.database,
        password: PUBLIC_DB_CONNECT_INFO.password,
      },
    });
    await use(dbPool);
  },
});

async function clearDropDb(dbName: string) {
  const manage = await getManage();
  try {
    await manage.dropDb(dbName);
  } finally {
    await manage.close();
  }
}

function getManage() {
  return DbManage.connect(DB_CONNECT_INFO);
}
