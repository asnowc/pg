import { test as viTest } from "vitest";
import { connect, DbManage, DbQueryPool, PgConnection, PgDbQueryPool } from "@asla/pg";
import process from "node:process";
import { DB_CONNECT_INFO, PUBLIC_DB_CONNECT_INFO } from "@test/utils/db.ts";
import { DenoConnByteStream } from "@/platforms.ts";
export interface BaseContext {
  emptyDbPool: DbQueryPool;
  connect: PgConnection;
}
const VITEST_WORKER_ID = +process.env.VITEST_WORKER_ID!;

export const test = viTest.extend<BaseContext>({
  async emptyDbPool({}, use) {
    const dbName = "test_empty_" + VITEST_WORKER_ID;

    const manage = await getManage();
    try {
      await manage.recreateDb(dbName);
    } finally {
      await manage.close();
    }
    const dbPool = new PgDbQueryPool({ ...DB_CONNECT_INFO, database: dbName });

    dbPool.open();
    await use(dbPool);
    const useCount = dbPool.totalCount - dbPool.idleCount;
    await dbPool.close(true);

    await clearDropDb(dbName);
    if (useCount !== 0) throw new Error("存在未释放的连接");
  },
  async connect({}, use) {
    await using connection = await denoConnect();
    await use(connection);
  },
});

async function clearDropDb(dbName: string) {
  try {
    const manage = await getManage();
    await manage.dropDb(dbName);
    await manage.close();
  } catch (error) {
    console.error(`清理用于测试的数据库 ${dbName} 失败`, error);
  }
}

function getManage() {
  return DbManage.connect(DB_CONNECT_INFO);
}

async function denoConnect() {
  const conn = await Deno.connect({ hostname: PUBLIC_DB_CONNECT_INFO.hostname, port: PUBLIC_DB_CONNECT_INFO.port });
  const stream = new DenoConnByteStream(conn);
  return connect(stream, { user: PUBLIC_DB_CONNECT_INFO.user, password: PUBLIC_DB_CONNECT_INFO.password });
}
