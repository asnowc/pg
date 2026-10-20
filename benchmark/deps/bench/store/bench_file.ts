/*

  数据格式为  int, json
*/

export function createBenchFileReader<T>(): TransformStream<Uint8Array, T> {
  return new TransformStream<Uint8Array, T>({
    transform(chunk, controller) {
      // Implement the transformation logic here
    },
  });
}
export function createBenchFileWriter<T>(): TransformStream<T, Uint8Array> {
  return new TransformStream<T, Uint8Array>({
    transform(chunk, controller) {
      // Implement the transformation logic here
    },
  });
}
