import { DbConnection } from "@asla/yoursql/client";
import { createDbConnection, DbConnectOption } from "./impl/mod.ts";

/** @public */
export interface CreateDataBaseOption {
  owner?: string;
}

/** @public */
export class DbManage {
  static async connect(url: string | URL | DbConnectOption) {
    const client = await createDbConnection(url);
    return new DbManage(client);
  }

  constructor(readonly dbClient: DbConnection) {}
  /** 删除 dbAddr 对应数据库 */
  async createDb(dbName: string, option: CreateDataBaseOption = {}) {
    const sql = genCreateDb(dbName, option);
    await this.dbClient.query(sql);
  }
  /** 删除 dbAddr 对应数据库 */
  async dropDb(dbName: string) {
    await this.dbClient.query(`DROP DATABASE IF EXISTS ${dbName}`);
  }
  async copy(templateDbName: string, newDbName: string) {
    const client = this.dbClient;
    await this.dropDb(newDbName);
    await client.query(`CREATE DATABASE ${newDbName} WITH TEMPLATE ${templateDbName}`);
  }
  close() {
    return this.dbClient.close();
  }
  async recreateDb(dbName: string) {
    await this.dropDb(dbName);
    await this.createDb(dbName);
  }
  [Symbol.asyncDispose]() {
    return this.close();
  }
}
function genCreateDb(dbName: string, option: CreateDataBaseOption = {}) {
  return `
CREATE DATABASE ${dbName}
WITH
${option.owner ? "OWNER=" + option.owner : ""}
ENCODING = 'UTF8'
LOCALE_PROVIDER = 'libc'
CONNECTION LIMIT = -1
IS_TEMPLATE = False;
  `;
}
