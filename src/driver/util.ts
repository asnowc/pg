import { DatabaseError } from "pg";

export function genErrPosition(text: string, index: number) {
  const from = index > 100 ? index - 100 : 0;
  return text.slice(from, index);
}
export function genPgSqlErrorMsg(
  error: DatabaseError,
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
export function findTextPositionLine(text: string, index: number) {
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

export function addPgErrorInfo(e: any, text: string): never {
  if (e instanceof DatabaseError && e.position) {
    if (e.position) {
      const index = parseInt(e.position);
      const target = genErrPosition(text, index);
      Reflect.set(e, "targetText", target);
      Reflect.set(e, "targetTextNext", text.slice(index, index + 50));
    }
  }
  throw e;
}
