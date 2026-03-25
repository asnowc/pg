/** @public */
export class ParallelQueryError extends Error {
  constructor() {
    super("The previous query was not completed and cannot be executed");
  }
}
/** @public */
export class ConnectionNotAvailableError extends Error {
  constructor(message: string) {
    super(message);
  }
}
