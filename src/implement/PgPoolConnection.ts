import type {
  CopyQueryOperation,
  ExtendedQueryOperation,
  SampleQueryOperation,
  TransactionQueryOperation,
} from "@/interface/Query.ts";

/** @public */
export interface PgPoolConnection
  extends ExtendedQueryOperation, SampleQueryOperation, CopyQueryOperation, TransactionQueryOperation, Disposable {
  get released(): boolean;
  /** 幂等释放。现有操作结束后才实际归还连接；此后不再接受新操作。 */
  release(): void;
  [Symbol.dispose](): void;
}
