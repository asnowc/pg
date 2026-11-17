export class AsyncAble<T> {
  constructor(private item: T | Promise<T>) {
    if (item instanceof Promise) {
      item.then(
        (data) => {
          this.item = data;
          return data;
        },
        () => {},
      );
    }
  }
  exec<R>(resolve: (item: T) => R): R | Promise<R>;
  exec<R, E>(resolve: (item: T) => R, reject: (err: unknown) => E): R | Promise<R | E>;
  exec<R, E>(resolve: (item: T) => R, reject?: (err: unknown) => E): R | Promise<R | E> {
    if (this.item instanceof Promise) {
      return this.item.then(resolve, reject);
    }
    return resolve(this.item);
  }
}
