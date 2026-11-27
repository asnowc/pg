import { SqlStatement, SqlStatements } from "@/interface/Query.ts";
import { BufferEncoder, Uint8ArrayEncoder, UTF16BufferEncoder } from "./encoder/_common.ts";
import { calcCStringByteLength } from "@/internal/string.ts";
import { NullByteError } from "@/internal/error.ts";
import { PreparedStatement, TypedSqlStatement } from "@/class/PreparedStatement.ts";
import { QueryPortalOptions, QueryPortal } from "./portal/QueryPortal.ts";
import { ReceiverType } from "./portal/QueryTask.ts";

export * from "./portal/QueryPortal.ts";
export * from "./portal/RowDescription.ts";
export * from "./portal/QueryTask.ts";

export class StatementPortal extends QueryPortal {
  constructor(statement: SqlStatement | TypedSqlStatement, options: QueryPortalOptions = {}) {
    super(ReceiverType.ExtendedQuery, options);
    if (typeof statement === "string" || statement instanceof Uint8Array) {
      statement = new PreparedStatement(statement);
    } else if (statement instanceof TypedSqlStatement) {
      this.getResultDecoder = statement.getResultDecoder;
    }
    this.statement = statement;
  }
  readonly statement: PreparedStatement;
}

export class MultipleStatementPortal extends QueryPortal {
  constructor(
    readonly statements: SqlStatements,
    options: QueryPortalOptions = {},
  ) {
    super(ReceiverType.SimpleQuery, options);
    if (typeof statements === "string") {
      this.encoder = new UTF16BufferEncoder(statements);
      this.statementsLength = calcCStringByteLength(statements);
    } else if (statements instanceof Uint8Array) {
      if (statements.includes(0)) throw new NullByteError();
      this.statementsLength = statements.byteLength;
      this.encoder = new Uint8ArrayEncoder(statements);
    } else {
      throw new Error("Unsupported statement type");
    }
  }
  readonly statementsLength: number;
  readonly encoder: BufferEncoder;
}
