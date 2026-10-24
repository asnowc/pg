import type { ConcurrencyBenchSample, RequestRunnerContext } from "../types/bench_result.ts";

class Event {
  private listeners: Map<string, Map<(...args: any[]) => void, boolean>> = new Map();
  private getEventListeners(name: string) {
    let listeners = this.listeners.get(name);
    if (!listeners) {
      listeners = new Map();
      this.listeners.set(name, listeners);
    }
    return listeners;
  }
  on(name: string, callback: (...args: any[]) => void) {
    this.getEventListeners(name).set(callback, false);
  }
  once(name: string, callback: (...args: any[]) => void) {
    this.getEventListeners(name).set(callback, true);
  }
  off(name: string, callback: (...args: any[]) => void) {
    this.listeners.get(name)?.delete(callback);
  }
  emit(name: string, ...args: any[]) {
    const listeners = this.listeners.get(name);
    if (!listeners) return;
    listeners.forEach((once, callback) => {
      callback(...args);
      if (once) {
        listeners.delete(callback);
      }
    });
  }
}

export class ConcurrencyRunner extends Event implements RequestRunnerContext {
  /** 预期的并发数 */
  targetConcurrency = 0;
  currentConcurrency = 0;
  nextRequestIndex = 0;
  successCount = 0;
  errorCount = 0;
  getStateSnapshot() {
    return {
      targetConcurrency: this.targetConcurrency,
      currentConcurrency: this.currentConcurrency,
      nextRequestIndex: this.nextRequestIndex,
      successCount: this.successCount,
      errorCount: this.errorCount,
    };
  }
  /** 成功的采样回调 */
  onSampleSuccess(data: ConcurrencyBenchSample, requestIndex: number) {}
  /** 失败的采样回调 */
  onSampleFailed(data: ConcurrencyBenchSample, requestIndex: number, error: unknown) {}

  private onClear() {
    this.emit("clear");
  }
  waitClear() {
    if (this.currentConcurrency === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.once("clear", resolve));
  }

  constructor(private fn: (index: number) => Promise<unknown>) {
    super();
  }

  private onRequestError(data: ConcurrencyBenchSample, index: number, error: unknown) {
    const end = performance.now();
    this.errorCount++;
    this.currentConcurrency--;
    data[1] = end;
    this.onSampleFailed(data, index, error);
    this.onReduce(end);
  }
  private onRequestSuccess(data: ConcurrencyBenchSample, index: number) {
    const end = performance.now();
    this.successCount++;
    this.currentConcurrency--;
    data[1] = end;
    this.onSampleSuccess(data, index);

    this.onReduce(end);
  }
  private onReduce(end: number) {
    if (this.currentConcurrency < this.targetConcurrency) {
      this.requestNext(end);
    } else if (this.currentConcurrency === 0) {
      this.onClear();
    }
  }
  updateConcurrency(value: number) {
    this.targetConcurrency = value;
    const start = performance.now();
    while (this.currentConcurrency < this.targetConcurrency) {
      this.requestNext(start);
    }
    return;
  }
  private requestNext(start: number) {
    this.currentConcurrency++;
    const i = this.nextRequestIndex++;
    const data: ConcurrencyBenchSample = [start, 0];
    new Promise<unknown>((resolve) => resolve(this.fn.call(undefined, i))).then(
      () => this.onRequestSuccess(data, i),
      (e) => this.onRequestError(data, i, e),
    ).catch((e) => {
      console.error("Unhandled error in callBenchFn", e);
      this.targetConcurrency = 0;
    });
  }
}
