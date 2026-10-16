export type PoolInfo<T> = {
  createPool: (info: { poolSize: number }) => Promise<T> | T;
  closePool: (pool: T) => Promise<void>;
  name: string;
};

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

export type ConnectHandler<T, P = void> = {
  name: string;
  connect: () => Promise<{ pool: P; conn: T }>;
  close: (conn: T, pool: P) => Promise<void>;
};

export type QueryTest<T, P = void> = TestQueries<T> & ConnectHandler<T, P>;
export type PoolQueryTest<T> = TestQueries<T> & PoolHandler<T>;
