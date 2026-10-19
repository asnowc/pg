import type { ConnectionStream } from "@/_utils/ConnectionStream.ts";
import { InternalError } from "@/_utils/error.ts";
import { BufferReader } from "@/_utils/StreamReader.ts";
import type { PgConnection, PgConnectOptions, PgNetConnectOptions, PrunedDenoConn } from "@/interface/Connection.ts";
import { createSession } from "@/implement.ts";

const textDecoder = new TextDecoder();

export class DenoConnBufferStream extends BufferReader implements ConnectionStream {
  constructor(private conn: PrunedDenoConn, readerBufferSize?: number) {
    readerBufferSize = readerBufferSize ?? 16 * 1024;
    super(new Uint8Array(readerBufferSize));
  }
  #onError = (err: unknown) => {
    if (this.onError) this.onError(err instanceof Error ? err : new Error(String(err)));
    else console.error(new InternalError("Unhandled error in DenoBufferStream"));
    this.destroy();
  };
  private onError?: (error: Error) => void;
  listenOnError(onError?: (error: Error) => void): void {
    if (onError && this.onError) throw new InternalError("Error listener already set");
    this.onError = onError;
  }
  startReadLoop(onData: () => boolean | void, onEnd: () => void) {
    this.#startReadLoop(onData, onEnd).catch(this.#onError);
    return;
  }
  async #startReadLoop(onData: () => boolean | void, onEnd: () => void) {
    let isEnd: boolean | void | undefined;
    let size: number | null;
    do {
      this.gc();
      const chunk = this.buffer.subarray(this.readerBufferWriteOffset);
      if (chunk.byteLength === 0) {
        throw new InternalError("The BufferReader did not read any data when the onData method was called");
      }
      size = await this.conn.read(chunk);
      if (size === null) return onEnd();
      if (size === 0) continue;

      this.readerBufferWriteOffset += size;
      isEnd = onData();
    } while (!isEnd);
  }

  write(data: Uint8Array): Promise<number> {
    return this.conn.write(data);
  }
  closeWrite(): Promise<void> {
    return this.conn.closeWrite();
  }
  private destroyed = false;
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      this.conn.close();
    } catch {
      // The socket may already be closed after EOF.
    }
  }
}

export async function connectFromDenoTCP(options: PgNetConnectOptions): Promise<PgConnection> {
  const { hostname, port, encryption, ...rest } = options;

  const stream = await Deno.connect({ hostname, port });
  return createSession(stream, { ...rest, encryption: encryption?.map(mapEncryption) });
}

function mapEncryption(
  option: NonNullable<PgNetConnectOptions["encryption"]>[number],
): NonNullable<PgConnectOptions<Deno.TcpConn>["encryption"]>[number] {
  switch (option.mode) {
    case "TLS": {
      const caCerts = option.ca?.map((cert) => (typeof cert === "string" ? cert : textDecoder.decode(cert)));
      return {
        mode: option.mode,
        upgradeTLS: async (conn) => {
          return Deno.startTls(conn, { caCerts });
        },
      };
    }
    default:
      throw new InternalError(`Deno unsupported encryption mode: ${(option as any).mode}`);
  }
}
