import type { PgOid } from "./pg_message.ts";
import type { PgMessageReader } from "./PgMessageReader.ts";

/**
 * PostgreSQL 日志序列号，使用无符号 64 位语义。
 * @public
 */
export type PgLsn = bigint;

/**
 * PostgreSQL 2000-01-01 纪元起的微秒数。
 * @public
 */
export type PgTimestamp = bigint;

/**
 * PostgreSQL 事务 ID。
 * @public
 */
export type PgTransactionId = number;

/** @public */
export interface PgStartPhysicalReplicationOptions {
  startLsn: PgLsn;
  slot?: string;
  timeline?: bigint;
}

/** @public */
export interface PgStartLogicalReplicationOptions {
  startLsn: PgLsn;
  slot: string;
  pluginOptions?: Readonly<Record<string, string | true>>;
}

/**
 * 复制命令只允许通过简单查询协议发送。
 * @public
 */
export declare function startPhysicalReplication(
  stream: PgMessageReader,
  options: PgStartPhysicalReplicationOptions,
): Promise<void>;
/** @public */
export declare function startLogicalReplication(
  stream: PgMessageReader,
  options: PgStartLogicalReplicationOptions,
): Promise<void>;

/** @public */
export type PgPrimaryReplicationMessage =
  | {
    type: "xLogData";
    walStart: PgLsn;
    walEnd: PgLsn;
    serverTime: PgTimestamp;
    data: Uint8Array;
  }
  | {
    type: "primaryKeepalive";
    walEnd: PgLsn;
    serverTime: PgTimestamp;
    replyRequested: boolean;
  };

/** @public */
export interface PgStandbyStatusUpdate {
  writtenLsn: PgLsn;
  flushedLsn: PgLsn;
  appliedLsn: PgLsn;
  clientTime: PgTimestamp;
  replyRequested?: boolean;
}

/** @public */
export interface PgHotStandbyFeedback {
  clientTime: PgTimestamp;
  xmin: PgTransactionId;
  xminEpoch: number;
  catalogXmin: PgTransactionId;
  catalogXminEpoch: number;
}

/**
 * 解析 CopyData 内的 XLogData 或主库 keepalive。
 * @public
 */
export declare function parsePrimaryReplicationMessage(data: Uint8Array): PgPrimaryReplicationMessage;
/**
 * 将 standby status 封装为 CopyData 并发送。
 * @public
 */
export declare function standbyStatusUpdate(stream: PgMessageReader, status: PgStandbyStatusUpdate): Promise<void>;
/**
 * 将 hot standby feedback 封装为 CopyData 并发送。
 * @public
 */
export declare function hotStandbyFeedback(stream: PgMessageReader, feedback: PgHotStandbyFeedback): Promise<void>;

/** @public */
export type PgLogicalTupleValue =
  | { format: "null" }
  | { format: "unchangedToast" }
  | { format: "text" | "binary"; value: Uint8Array };

/** @public */
export interface PgLogicalTuple {
  values: readonly PgLogicalTupleValue[];
}

/** @public */
export interface PgLogicalRelationColumn {
  key: boolean;
  name: string;
  dataTypeOid: PgOid;
  typeModifier: number;
}

/** @public */
export type PgLogicalReplicationMessage =
  | { type: "begin"; finalLsn: PgLsn; commitTime: PgTimestamp; xid: PgTransactionId }
  | { type: "commit"; commitLsn: PgLsn; endLsn: PgLsn; commitTime: PgTimestamp }
  | { type: "origin"; originLsn: PgLsn; name: string }
  | {
    type: "relation";
    xid?: PgTransactionId;
    relationOid: PgOid;
    namespace: string;
    name: string;
    replicaIdentity: number;
    columns: readonly PgLogicalRelationColumn[];
  }
  | { type: "dataType"; xid?: PgTransactionId; dataTypeOid: PgOid; namespace: string; name: string }
  | { type: "insert"; xid?: PgTransactionId; relationOid: PgOid; newTuple: PgLogicalTuple }
  | {
    type: "update";
    xid?: PgTransactionId;
    relationOid: PgOid;
    oldTuple?: PgLogicalTuple;
    oldTupleKind?: "key" | "old";
    newTuple: PgLogicalTuple;
  }
  | {
    type: "delete";
    xid?: PgTransactionId;
    relationOid: PgOid;
    oldTupleKind: "key" | "old";
    oldTuple: PgLogicalTuple;
  }
  | {
    type: "truncate";
    xid?: PgTransactionId;
    relationOids: readonly PgOid[];
    cascade: boolean;
    restartIdentity: boolean;
  }
  | {
    type: "message";
    xid?: PgTransactionId;
    transactional: boolean;
    lsn: PgLsn;
    prefix: string;
    content: Uint8Array;
  }
  | { type: "streamStart"; xid: PgTransactionId; firstSegment: boolean }
  | { type: "streamStop" }
  | {
    type: "streamCommit";
    xid: PgTransactionId;
    commitLsn: PgLsn;
    endLsn: PgLsn;
    commitTime: PgTimestamp;
  }
  | {
    type: "streamAbort";
    xid: PgTransactionId;
    subtransactionXid: PgTransactionId;
    abortLsn?: PgLsn;
    abortTime?: PgTimestamp;
  }
  | {
    type: "twoPhase";
    action: "beginPrepare" | "prepare" | "commitPrepared" | "rollbackPrepared" | "streamPrepare";
    xid: PgTransactionId;
    gid: string;
    lsn: PgLsn;
    endLsn: PgLsn;
    time: PgTimestamp;
  }
  | { type: "unknown"; code: number; data: Uint8Array };

/** @public */
export interface PgLogicalDecodeOptions {
  /** pgoutput 协议版本 1 至 4，决定可出现的字段。 */
  protocolVersion: 1 | 2 | 3 | 4;
  streaming?: false | true | "parallel";
}

/**
 * 解析 XLogData.data 中由 pgoutput 产生的一条逻辑复制消息。
 * @public
 */
export declare function parseLogicalReplicationMessage(
  data: Uint8Array,
  options: PgLogicalDecodeOptions,
): PgLogicalReplicationMessage;

/**
 * 将 PostgreSQL LSN 文本（例如 16/B374D848）转为 bigint。
 * @public
 */
export declare function parseLsn(value: string): PgLsn;
/**
 * 将 bigint LSN 格式化为 PostgreSQL 接受的十六进制文本。
 * @public
 */
export declare function formatLsn(value: PgLsn): string;
