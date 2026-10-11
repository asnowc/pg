import type {
  CopyQueryOperation,
  SingleQueryOperation,
  MultipleQueryOperation,
  TransactionQueryOperation,
} from "@/interface/Query.ts";

/** @public */
export interface PgPoolConnection
  extends SingleQueryOperation, MultipleQueryOperation, CopyQueryOperation, TransactionQueryOperation, Disposable {
  get released(): boolean;
  /** 关闭连接，不会归还到连接池 */
  close(): void;
  /** 幂等释放。现有操作结束后才实际归还连接；此后不再接受新操作。 */
  release(): void;
  /** 等同于 release 方法，用于在 using 语句中自动释放连接。 */
  [Symbol.dispose](): void;
}
