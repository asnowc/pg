/** TCP、Unix Socket 或 TLS 连接需要实现的字节流。 */
export interface ByteStream {
  /**
   * 读取指定字节长度的数据，返回包含读取数据的 Uint8Array。如果 EOF 提前到达，则抛出异常。
   * 调用后在 Promise 未完成前，不能再次调用 readInto 和 read 方法。
   */
  read(byteLength: number): Promise<Uint8Array>;
  /**
   * 读取数据到指定的缓冲区，如果 EOF 提前到达，则抛出异常。
   * 调用后在 Promise 未完成前，不能再次调用 readInto 和 read 方法。
   */
  readInto(buffer: Uint8Array): Promise<void>;
  /** 允许并行写入；调用顺序和并发调度由实现负责。 */
  write(buffer: Uint8Array): Promise<number>;
  /** 关闭写入端 */
  closeWrite(): Promise<void>;
  /** 关闭整个连接，包括读写通道。 */
  close(): void;
}
