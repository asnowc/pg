import type { ReadableBuffer } from "@/_utils/ReadBuffer.ts";
import type { WriteBuffer } from "@/_utils/WriterBuffer.ts";

export interface DataStream extends WriteBuffer {
  /**
   * @param onData 返回一个布尔值，指示是否结束读取数据，如果返回 true 则结束读取
   * @param onEnd 读取到 EOF 时调用
   */
  startReadLoop(onData: (buffer: ReadableBuffer) => boolean | undefined | void, onEnd: () => void): void;
  listenOnError(onError: undefined | ((error: Error) => void)): void;
  /** 刷新缓冲数据后关闭写端。 */
  closeWrite(): Promise<void>;
  destroy(): void;
}
