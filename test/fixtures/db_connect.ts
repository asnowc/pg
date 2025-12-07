import { test as viTest } from "vitest";
import { DbManage, DbQueryPool, parserDbConnectUrl, PgDbQueryPool } from "@asla/pg";
import process from "node:process";
export interface BaseContext {
  emptyDbPool: DbQueryPool;
}
const VITEST_WORKER_ID = +process.env.VITEST_WORKER_ID!;
const DB_CONNECT_INFO = getConfigEnv(process.env);

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
});
function getConfigEnv(env: Record<string, string | undefined>) {
  const url = env["TEST_LOGIN_DB"];
  if (!url) throw new Error("缺少 TEST_LOGIN_DB 环境变量");
  return parserDbConnectUrl(url);
}
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
