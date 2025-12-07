import { DbQuery } from "@asla/yoursql/client";
import fs from "node:fs/promises";
import { DatabaseError } from "./driver/mod.js";
import { genPgSqlErrorMsg } from "./driver/util.ts";

export async function execSqlFile(pathname: string, client: DbQuery): Promise<void> {
  const file = await fs.readFile(pathname, "utf-8");
  try {
    await client.query(file);
  } catch (error) {
    if (error instanceof DatabaseError) {
      const detail = genPgSqlErrorMsg(error, { sqlFileName: pathname, sqlText: file });
      error.message = `执行SQL文件失败:${error.message}\n${detail}`;
      throw error;
    } else {
      throw new Error(`执行SQL文件失败\n${pathname}`, { cause: error });
    }
  }
}
