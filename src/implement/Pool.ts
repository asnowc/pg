import { PgSession } from "@/protocol.ts";
import { eachLink, LinkList } from "@/_utils/LinkList.ts";

export type PoolConnState = {
  /** isFree 状态更新的最后更新时间 */
  date: number;
  borrowed: boolean;
  idle: boolean;
};
export type PoolPgSession = PgSession<PoolConnState>;
export class Pool {
  constructor(idleTimeout: number) {
    this.idleTimeout = idleTimeout;
  }
  pool = new Set<PoolPgSession>();
  free = new Set<PoolPgSession>(); // 空闲的连接
  get connectedCount() {
    return this.pool.size;
  }

  /** 空闲回收时间（毫秒） */
  private idleTimeout: number;
  #timer?: NodeJS.Timeout;

  private setTimeoutCheck() {
    if (this.#timer || this.idleTimeout <= 0) return;
    if (this.closed || this.free.size === 0) return;
    this.#timer = setTimeout(() => {
      checkTimeout(this.pool, this.free, this.idleTimeout);
      this.#timer = undefined;
      this.setTimeoutCheck();
    }, this.idleTimeout);
  }
  clearTimer() {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
  }

  /** 将新的连接加入连接池 */
  addItem(session: PoolPgSession) {
    this.pool.add(session);
    this.freeItem(session);
  }
  /** 将 session 放回空闲池 */
  freeItem(session: PoolPgSession) {
    session.meta.idle = true;
    const next = this.waitQueue.head;
    if (next) {
      this.waitQueue.shift();
      session.meta.borrowed = !next.pipeline;
      session.meta.idle = !next.pipeline;
      return next.resolve(session);
    }
    if (this.closed) return void closeByteStream(session);

    session.meta.borrowed = false;
    session.meta.date = Date.now();
    this.free.add(session);
    this.setTimeoutCheck();
  }
  /** 等待队列，存放等待获取连接的请求 */
  readonly waitQueue = new LinkList<{
    pipeline: boolean;
    resolve(session: PoolPgSession): void;
    reject(reason: unknown): void;
  }>();
  pushWait(item: { pipeline: boolean; resolve(session: PoolPgSession): void; reject(reason: unknown): void }) {
    this.waitQueue.push(item);
  }
  clearWaitQueue(error: Error) {
    for (const item of eachLink(this.waitQueue.head)) {
      item.reject(error);
    }
    this.waitQueue.clear();
  }

  closed = false;
  /** 关闭连接池。关闭后不再接受新的连接请求。Promise 在所有连接关闭后完成。 */
  close(): void | Promise<unknown>[] {
    if (this.closed) return;
    this.closed = true;
    this.clearTimer();

    const promises: Promise<void>[] = [];
    for (const session of this.free) {
      this.pool.delete(session);
      promises.push(session.close());
    }
    this.free.clear();
    return promises;
  }
}
function checkTimeout(map: Set<PgSession>, free: Set<PoolPgSession>, timeout: number) {
  const now = Date.now();
  for (const session of free) {
    const state = session.meta;
    if (now - state.date > timeout) {
      free.delete(session);
      map.delete(session);
      closeByteStream(session);
    }
  }
}
export function closeByteStream(session: PgSession) {
  session.close().catch(() => {});
}
