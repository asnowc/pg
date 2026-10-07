import type { StreamReader } from "@/_utils/StreamReader.ts";

export interface ConnectionStream extends StreamReader, Writer {
  /**
   * @param onData 返回一个布尔值，指示是否结束读取数据，如果返回 true 则结束读取
   * @param onEnd 读取到 EOF 时调用
   */
  startReadLoop(onData: () => boolean | undefined | void, onEnd: () => void): void;
  destroy(): void;
  listenOnError(onError: undefined | ((error: Error) => void)): void;
}
export interface Writer {
  write(data: Uint8Array): Promise<number>;
  closeWrite(): Promise<void>;
}

export async function writeData(writer: Writer, data: Uint8Array) {
  let offset = 0;
  while (offset < data.byteLength) {
    const written = await writer.write(data.subarray(offset));
    offset += written;
  }
}
