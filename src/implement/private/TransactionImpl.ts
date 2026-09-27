import type {
  Cursor,
  CursorOpenOptions,
  QueryOptions,
  QueryReader as IQueryReader,
  SqlStatement,
  Transaction,
  TransactionMode,
  TypedSqlStatement,
  TypedSqlStatementEncoder,
} from "@/interface/Query.ts";
import type { PgSession } from "@/protocol/PgSession.ts";
import { PgTransactionStatus } from "@/protocol/const.ts";
import type { Pool } from "@/_utils/ResourcePool.ts";
import { createTypeSqlStatementEncoder } from "@/sql/SqlStatementEncoder.ts";
import { sqlStatementToSqlEncoder } from "./sql_statement.ts";
import QueryReader from "./QueryReader.ts";

function quoteIdentifier(name: string): string {
  if (!name || name.includes("\0")) throw new TypeError("Invalid savepoint name");
  return `"${name.replaceAll('"', '""')}"`;
}

export class TransactionImpl implements Transaction {
  readonly mode: TransactionMode;
  private readonly session: Promise<PgSession>;
  private ended = false;
  private active = false;

  constructor(private readonly pool: Pool<PgSession>, mode: TransactionMode = "READ COMMITTED") {
    this.mode = mode;
    this.session = pool.get().then(async (session) => {
      try {
        await session.beginTransaction(mode);
        return session;
      } catch (error) {
        pool.release(session);
        throw error;
      }
    });
    void this.session.catch(() => {});
  }

  get released(): boolean {
    return this.ended;
  }

  private async getSession(): Promise<PgSession> {
    if (this.ended) throw new Error("Transaction is released");
    return await this.session;
  }

  query<T>(
    queryable: SqlStatement<T> | TypedSqlStatementEncoder<T>,
    options?: QueryOptions & Pick<TypedSqlStatement, "typeDecoders" | "columnDecoders">,
  ): IQueryReader<T> {
    const statement = sqlStatementToSqlEncoder(queryable, options);
    return new QueryReader<T>(
      {
        get: () => this.getSession(),
        release: () => {},
      },
      statement,
      false,
    );
  }

  open<T>(_queryable: SqlStatement<T>, _options?: CursorOpenOptions): Promise<Cursor<T>> {
    throw new Error("Not implemented");
  }

  async savePoint(name: string): Promise<void> {
    const statement = createTypeSqlStatementEncoder(`SAVEPOINT ${quoteIdentifier(name)}`);
    await (await this.getSession()).extendedQuery(statement, false);
  }

  async rollbackTo(name: string): Promise<void> {
    const quoted = quoteIdentifier(name);
    const session = await this.getSession();
    await session.synchronize();
    await session.extendedQuery(createTypeSqlStatementEncoder(`ROLLBACK TO SAVEPOINT ${quoted}`), false);
  }

  private async finish(command: "ROLLBACK" | "COMMIT"): Promise<void> {
    if (this.ended) return;
    if (this.active) throw new Error("Transaction is already ending");
    this.active = true;
    let session: PgSession;
    try {
      session = await this.session;
    } catch (error) {
      this.ended = true;
      throw error;
    }
    try {
      const result = session.extendedQuery(createTypeSqlStatementEncoder(command), false);
      const ready = session.synchronize();
      try {
        await result;
        if (await ready !== PgTransactionStatus.Idle) throw new Error("Transaction did not finish");
      } catch (error) {
        try {
          if (await ready !== PgTransactionStatus.Idle) {
            const rollback = session.extendedQuery(createTypeSqlStatementEncoder("ROLLBACK"), false);
            const recovered = session.synchronize();
            await rollback;
            if (await recovered !== PgTransactionStatus.Idle) throw new Error("ROLLBACK did not finish");
          }
        } catch {
          session.destroy();
        }
        throw error;
      }
    } finally {
      this.ended = true;
      this.pool.release(session);
    }
  }

  commit(): Promise<void> {
    return this.finish("COMMIT");
  }

  rollback(): Promise<void> {
    return this.finish("ROLLBACK");
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.rollback();
  }
}
