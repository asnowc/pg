import path from "node:path";

export interface TestQueries<T> {
  select: (client: T) => Promise<void>;
  selectArg: (client: T) => Promise<void>;
  selectArgs: (client: T) => Promise<void>;
  selectWhere: (client: T) => Promise<void>;
}
export type PoolHandler<T> = {
  createPool: (info: { poolSize: number }) => Promise<T> | T;
  closePool: (pool: T) => Promise<void>;
  name: string;
};

export type ConnectHandler<T> = {
  name: string;
  connect: () => Promise<T>;
  close: (conn: T) => Promise<void>;
};

export type QueryTest<T> = TestQueries<T> & ConnectHandler<T>;
export type PoolQueryTest<T> = TestQueries<T> & PoolHandler<T>;

/** 报告根目录；每个脚本一次运行共用一个目录。 */
const OUTPUT_DIRECTORY = path.resolve(import.meta.dirname!, "../results");

export function getReportDirectory(meta: ImportMeta) {
  const filename = path.parse(meta.filename!).name;
  return path.join(OUTPUT_DIRECTORY, `${filename}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
}
