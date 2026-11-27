export type MaybePromise<T> = Awaited<T> | Promise<Awaited<T>>;

export function processMaybePromise<T, R>(data: MaybePromise<T>, resolve: (item: T) => R): R | Promise<Awaited<R>> {
  if (data instanceof Promise) {
    return data.then(resolve) as Promise<Awaited<R>>;
  }
  return resolve(data);
}
