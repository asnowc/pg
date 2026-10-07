export class EventEmitter {
  #events = new Map<string, Set<Listener>>();
  on<T extends unknown[]>(event: string, callback: (this: this, data: T) => unknown) {
    let listeners = this.#events.get(event);
    if (!listeners) {
      listeners = new Set();
      this.#events.set(event, listeners);
    }
    listeners.add(callback);
  }
  off(event: string, callback: Listener) {
    const listeners = this.#events.get(event);
    if (!listeners) return;
    listeners.delete(callback);
  }
  emit(event: string, data: unknown): boolean {
    const listeners = this.#events.get(event);
    if (!listeners || listeners.size === 0) return false;
    for (const listener of listeners) {
      listener(data);
    }
    return true;
  }
}
export type Listener = (...args: any[]) => unknown;
