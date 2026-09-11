/** @public */
export interface ResourceManager<T> {
  create(): Promise<T>;
  dispose(conn: T, force?: boolean): void;
}
type PoolConnState = {
  /** 连接是否为空闲状态 */
  isFree: boolean;
  /** 连接被使用的总次数 */
  useTotal: number;
  /** isFree 状态更新的最后更新时间 */
  date: number;
};
/**
 * 资源池，可以用于实现连接池
 * @public
 */
export class ResourcePool<T> {
  static defaultMaxCount = 3;
  #pool = new Map<T, PoolConnState>();
  #free = new Set<T>();
  constructor(handler: ResourceManager<T>, option: PoolOption = {}) {
    this.#handler = handler;
    this.#maxCount = option.maxCount ?? ResourcePool.defaultMaxCount;
    this.#freeTimeout = option.idleTimeout ?? 0;
    this.#usageLimit = option.usageLimit ?? 0;
    this.#retryMaxCount = option.createRetry ?? 3;
  }
  #freeDequeue() {
    for (const item of this.#free) {
      this.#free.delete(item);
      return item;
    }
  }
  #handler: ResourceManager<T>;
  /** 由于连接自身原因（如断开连接），需要从连接池移除这个连接。移除的连接不会调用 handler.dispose() */
  remove(conn: T): void {
    const info = this.#pool.get(conn);
    if (!info) return;
    this.#pool.delete(conn);
    this.#free.delete(conn);

    if (this.closed) this.#checkCloseResolve?.();
    else this.#checkConnect();
  }
  #onConnectFree(conn: T, state: PoolConnState) {
    if (this.#usageLimit > 0 && state.useTotal >= this.#usageLimit) {
      this.#pool.delete(conn);
      this.#handler.dispose(conn);
      if (this.closed) this.#checkCloseResolve?.();
      else this.#checkConnect();
      return;
    }

    const item = this.#queue.shift();
    state.date = Date.now();
    if (item) {
      state.useTotal++;
      state.isFree = false;
      item.resolve(conn);
      return;
    }
    if (this.closed) {
      this.#pool.delete(conn);
      this.#handler.dispose(conn);
      this.#checkCloseResolve?.();
      return;
    }

    this.#free.add(conn);
    state.isFree = true;
    if (this.#timer === undefined && this.#freeTimeout) {
      this.#timer = setTimeout(this.#onTimeoutCheck, this.#freeTimeout + 50);
    }
  }
  #createConnect() {
    const onConnect = (conn: T) => {
      this.#errorCount = 0;
      this.#connectingCount--;

      const state: PoolConnState = { isFree: true, useTotal: 0, date: Date.now() };
      this.#pool.set(conn, state);
      this.#onConnectFree(conn, state);
    };
    const onConnectError = (error: unknown) => {
      this.#connectingCount--;

      if (++this.#errorCount > this.#retryMaxCount || this.closed) {
        for (const item of this.#queue) {
          item.reject(error);
        }
        this.#queue = [];
        this.#errorCount = 0;
        this.#checkCloseResolve?.();
        return;
      }
      this.#checkConnect();
    };
    callFn(this.#handler.create.bind(this.#handler), onConnect, onConnectError);

    this.#connectingCount++;
  }
  #checkConnect() {
    if (!this.#queue.length) return;
    if ((this.#pool.size + this.#connectingCount < this.#maxCount)) {
      this.#createConnect();
    }
  }

  #queue = Array<{ resolve(conn: T): void; reject(e: any): void }>();
  get(): Promise<T> {
    if (this.#closedError) return Promise.reject(this.#closedError);
    if (this.#free.size) {
      const conn = this.#freeDequeue()!;
      const state = this.#pool.get(conn)!;
      state.isFree = false;
      state.date = Date.now();
      state.useTotal++;
      return Promise.resolve(conn);
    }
    return new Promise<T>((resolve, reject) => {
      this.#queue.push({ resolve, reject });
      this.#checkConnect();
    });
  }
  release(conn: T) {
    const state = this.#pool.get(conn);
    if (!state) throw new Error("这个连接不属于这个池");
    this.#onConnectFree(conn, state);
  }

  /** 连接池最大数量 */
  get maxCount(): number {
    return this.#maxCount;
  }
  #maxCount: number;

  /** 使用次数上限。超过这个值后将关闭连接。如果为0则无上限 */
  get usageLimit(): number {
    return this.#usageLimit;
  }
  #usageLimit: number;

  /** 空闲时间超过这个数后将自动释放连接，如果为0则关闭空闲超时。 */
  get freeTimeout(): number {
    return this.#freeTimeout;
  }
  #freeTimeout: number;

  #checkCloseResolve?: () => void;
  #closedError?: Error;
  #closing?: Promise<void>;
  /**
   * 关闭连接池。空闲连接将会被立即关闭。
   * @param force
   *  0：等待排队中的请求被解决，然后等待所有已被借用的连接释放后再 resolve。
   *  1：排队中的请求会被立即拒绝，等待所有已被借用的连接释放后再 resolve。
   *  2：排队中的请求会被立即拒绝，已经被借用的连接将被立即销毁，
   * @param err 关闭时的错误信息。
   */
  close(force: 0 | 1 | 2 = 0, err: Error = new Error("Pool is closed")): Promise<void> {
    if (this.closed) return this.#closing ?? Promise.resolve();
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    this.#closedError = err;

    for (const item of this.#free) {
      this.#pool.delete(item);
      this.#handler.dispose(item);
    }
    this.#free.clear();

    if (force > 0) {
      for (const item of this.#queue) {
        item.reject(err);
      }
      this.#queue.length = 0;

      if (force === 2) {
        //TODO: 中断正在创建中的连接
        for (const conn of this.#pool.keys()) {
          this.#handler.dispose(conn, true);
        }
        this.#pool.clear();
        return Promise.resolve();
      }
    }

    this.#closing = new Promise<void>((resolve, reject) => {
      this.#checkCloseResolve = () => {
        if (this.#pool.size + this.#connectingCount + this.#queue.length <= 0) {
          resolve();
          this.#checkCloseResolve = undefined;
          this.#closing = undefined;
        }
      };
      this.#checkCloseResolve();
    });
    return this.#closing;
  }
  /** 池是否已关闭 */
  get closed(): boolean {
    return !!this.#closedError;
  }

  /** 创建连接中的数量 */
  #connectingCount = 0;
  /** 连续创建失败的次数 */
  #errorCount = 0;
  /** 允许的最大连续失败次数 */
  #retryMaxCount: number;

  /** 当前保持连接的数量 */
  get totalCount(): number {
    return this.#pool.size;
  }
  /** 空闲连接数量 */
  get idleCount(): number {
    return this.#free.size;
  }
  /** 排队中的数量 */
  get waitingCount(): number {
    return this.#queue.length;
  }

  #timer?: NodeJS.Timeout;
  #onTimeoutCheck = () => {
    if (this.#freeTimeout <= 0) {
      this.#timer = undefined;
      return;
    }
    this.removeFreeTimeout(this.#freeTimeout);
    if (this.#free.size && this.#freeTimeout) {
      this.#timer = setTimeout(this.#onTimeoutCheck, this.#freeTimeout);
    } else {
      this.#timer = undefined;
    }
  };

  /**
   * 删除空虚时间超过 idleTimeout 的空闲连接
   * @param idleTimeout 空闲超时时间，单位毫秒
   */
  removeFreeTimeout(idleTimeout: number) {
    const now = Date.now();

    for (const item of this.#free) {
      const state = this.#pool.get(item);
      if (state && (now - state.date > idleTimeout)) {
        this.#free.delete(item);
        this.#pool.delete(item);
        this.#handler.dispose(item);
      } else {
        break;
      }
    }

    this.#checkConnect();
  }
}
/** @public */
export type PoolOption = {
  /** 连接池保持的最大连接数量。 默认 3 */
  maxCount?: number;
  /** 空闲时间超过这个数后将自动释放连接。默认为 0  */
  idleTimeout?: number;
  /** 使用次数上限。超过这个值后将关闭连接。默认为 0 */
  usageLimit?: number;
  /** 连接创建失败后的重试次数。默认为 3。当某个连接失败后，会清空等待队列 */
  createRetry?: number;
};

function callFn<T>(fn: () => Promise<T> | T, onOk: (data: T) => void, onError: (error: unknown) => void) {
  let result: T | Promise<T>;
  try {
    result = fn();
  } catch (error) {
    onError(error);
    return;
  }
  if (result instanceof Promise) {
    result.then(onOk, onError);
  } else {
    onOk(result);
  }
}
