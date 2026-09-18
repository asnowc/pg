/**
 * @public
 * @deprecated 旧查询抽象错误将在后续版本移除。
 */
export class ParallelQueryError extends Error {
  constructor() {
    super("The previous query was not completed and cannot be executed");
  }
}
/**
 * @public
 * @deprecated 请依据 `PgConnection.closed` 判断连接状态。
 */
export class ConnectionNotAvailableError extends Error {
  constructor(message: string) {
    super(message);
  }
}
