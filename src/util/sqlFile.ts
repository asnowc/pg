import type { DbQuery } from "#abstract";
import fs from "node:fs/promises";
import { PgDatabaseError } from "../connect/PgDatabaseError.ts";

/**
 * @public
 * @deprecated 请读取 SQL 文件后通过 `PgConnection.simpleQuery()` 执行。
 */
export async function execSqlFile(pathname: string, client: DbQuery): Promise<void> {
  const file = await fs.readFile(pathname, "utf-8");
  try {
    await client.query(file);
  } catch (error) {
    if (error instanceof PgDatabaseError) {
      const detail = genPgSqlErrorMsg(error, { sqlFileName: pathname, sqlText: file });
      error.message = `执行SQL文件失败:${error.message}\n${detail}`;
      throw error;
    } else {
      throw new Error(`执行SQL文件失败\n${pathname}`, { cause: error });
    }
  }
}
function genErrPosition(text: string, index: number) {
  const from = index > 100 ? index - 100 : 0;
  return text.slice(from, index);
}
function genPgSqlErrorMsg(
  error: { code?: string; position?: string },
  option: {
    sqlText?: string;
    sqlFileName?: string;
  } = {},
) {
  const { sqlFileName = "text", sqlText } = option;
  let detail = "";
  if (error.code) detail += ` (code ${error.code})`;
  if (error.position && sqlText) {
    const offset = parseInt(error.position);
    const [line, position] = findTextPositionLine(sqlText, offset);
    detail += ` ${sqlFileName}:${line}:${position}`;
    detail += "\n" + genErrPosition(sqlText, offset);
  }
  return detail;
}
function findTextPositionLine(text: string, index: number) {
  const matchLine = /(\r\n?)|(\n)/g;
  let line = 1;
  let offset = 0;
  let next = 0;
  for (const n of text.matchAll(matchLine)) {
    next = n.index + n[0].length;
    if (next >= index) {
      return [line, index - offset];
    }
    offset = next;
    line++;
  }
  return [line, index - offset];
}
