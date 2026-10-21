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
