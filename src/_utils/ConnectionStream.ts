import type { StreamReader } from "@/_utils/StreamReader.ts";
import type { StreamWriter } from "@/_utils/StreamWriter.ts";

export interface ConnectionStream extends StreamReader, StreamWriter {
  /**
   * @param onData 返回一个布尔值，指示是否结束读取数据，如果返回 true 则结束读取
   * @param onEnd 读取到 EOF 时调用
   */
  startReadLoop(onData: () => boolean | undefined | void, onEnd: () => void): void;
  destroy(): void;
  closeWrite(): Promise<void>;
}
