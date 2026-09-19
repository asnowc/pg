/** @public */
export interface AsyncReader {
  /**
   * 从异步读取器中读取数据到指定的缓冲区，返回实际读取的字节数。如果到达 EOF，则返回 null。
   */
  read(p: Uint8Array): Promise<number | null>;
}
/** @public */
export interface AsyncWriter {
  /**
   * 写入数据到异步写入器，返回实际写入的字节数。
   */
  write(p: Uint8Array): Promise<number>;
}
/** @public */
export interface ByteStream extends AsyncReader, AsyncWriter {
  /**
   * 关闭异步写入器的写入端。
   */
  closeWrite(): Promise<void>;
  /** 关闭整个字节流，包括读写通道。 */
  close(): void;
}
