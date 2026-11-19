import { PgSession } from "@/protocol.ts";
import { CountLinkList, eachLink, LinkList } from "@/_utils/LinkList.ts";
import { PgConnection } from "@/class/PgConnection.ts";

/**
 * 原生连接池配置。调用方建立流，连接池执行认证。
 * @public
 * @since 0.3.0
 */
export interface CreatePoolOptions {
  /**
   * 每次调用返回一个新的已连接流及认证选项，无需预先执行 PostgreSQL 认证。
   */
  create: () => Promise<PgConnection>;
  /**
   * 最大连接数，默认 3。必须是正整数。
   */
  maxCount?: number;
  /**
   * 每条连接最多同时承载的池级 query 请求数，默认 1。
   * 必须是正整数或 Infinity（不限制）；等待到对应 ReadyForQuery 后释放名额。
   * PostgreSQL 仍顺序执行这些请求。borrow() 借出的连接保持独占，不受此限制。
   */
  maxPipeline?: number;
  /**
   * 空闲回收时间（毫秒），默认 0（不回收）。
   */
  idleTimeout?: number;
  /**
   * 创建连接失败时的重试次数，默认 0（不重试）。
   */
  createRetry?: number;
}

export function checkOptions(options: CreatePoolOptions) {
  if (options.maxCount !== undefined && (!Number.isSafeInteger(options.maxCount) || options.maxCount <= 0)) {
    throw new RangeError("maxCount must be a positive integer");
  }
  if (
    options.maxPipeline !== undefined && options.maxPipeline !== Infinity &&
    (!Number.isSafeInteger(options.maxPipeline) || options.maxPipeline <= 0)
  ) {
    throw new RangeError("maxPipeline must be a positive integer or Infinity");
  }
  if (options.createRetry !== undefined && (!Number.isSafeInteger(options.createRetry) || options.createRetry < 0)) {
    throw new RangeError("createRetry must be a non-negative integer");
  }
  if (options.idleTimeout !== undefined && (!Number.isFinite(options.idleTimeout) || options.idleTimeout < 0)) {
    throw new RangeError("idleTimeout must be non-negative and finite");
  }
}

export class TimeoutChecker {
  constructor(private onCheck: (idleTimeout: number) => boolean, idleTimeout: number) {
    this.idleTimeout = idleTimeout;
  }
  /** 空闲回收时间（毫秒） */
  idleTimeout: number;
  #timer?: NodeJS.Timeout;
  setTimeIfNoSet() {
    if (this.#timer || this.idleTimeout <= 0) return;
    this.setTimeout();
  }

  private setTimeout() {
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      if (this.onCheck(this.idleTimeout)) this.setTimeout();
    }, this.idleTimeout);
  }
  clearTimer() {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
  }
}

export function checkTimeout(map: Set<PgSession>, idle: Map<PgSession, number>, timeout: number) {
  const now = Date.now();
  for (const [item, times] of idle) {
    if (now - times > timeout) {
      idle.delete(item);
      map.delete(item);
      closeByteStream(item);
    }
  }
}

export function closeByteStream(session: PgSession) {
  session.close().catch(() => {});
}
export function clearWaitQueue(queue: LinkList<WaitQueueItem>, error: Error) {
  for (const item of eachLink(queue.head)) {
    item.reject(error);
  }
  queue.clear();
}

export type WaitQueueItem = {
  pipeline?: number;
  resolve(session: PgSession): void;
  reject(reason: unknown): void;
};
export function shiftSet<T>(set: Iterable<T>, target: { delete(value: T): boolean }): T {
  for (const element of set) {
    target.delete(element);
    return element;
  }
  throw new Error("Set is empty");
}

export function getMinQueryNumberSession(pool: Set<PgSession>, maxPipeline: number) {
  let minSession: PgSession | undefined;
  for (const session of pool) {
    if (session.pendingQueyNumber >= maxPipeline) continue;
    if (!minSession || session.pendingQueyNumber < minSession.pendingQueyNumber) {
      minSession = session;
    }
  }
  return minSession;
}

export function closeIdleAndPipeline(idle: Iterable<PgSession>, pipeline: Iterable<PgSession>) {
  const promises: Promise<void>[] = [];
  for (const item of idle) promises.push(item.close().catch(() => item.destroy()));
  for (const item of pipeline) promises.push(item.close().catch(() => item.destroy()));
  return Promise.all(promises);
}
export function prepareConnection(size: number, create: () => Promise<void>) {
  const promises: Promise<void>[] = new Array(size);
  for (let i = 0; i < size; i++) {
    promises[i] = create();
  }
  return Promise.all(promises);
}
