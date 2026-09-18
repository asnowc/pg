import { Duplex } from "node:stream";
import type { ConnectionStream } from "@/_utils/ConnectionStream.ts";
import { InternalError } from "@/_utils/error.ts";
import { BufferReader } from "@/_utils/StreamReader.ts";
import { connect as connectTls } from "node:tls";
import { connect, Socket } from "node:net";
import { once } from "node:events";
import { Buffer } from "node:buffer";
import { PgConnection, PgConnectOptions, PgNetConnectOptions } from "@/interface/Connection.ts";
import { createSession } from "@/implement.ts";

export class DuplexBufferStream extends BufferReader implements ConnectionStream {
  constructor(private duplex: Duplex, readerBufferSize?: number) {
    readerBufferSize = readerBufferSize ?? 16 * 1024;
    super(new Uint8Array(readerBufferSize));
  }

  private onDataNotice: () => boolean | void = noListener;
  private onEnd: () => void = noListener;
  private onError?: (error: Error) => void;
  listenOnError(onError?: (error: Error) => void): void {
    if (onError && this.onError) throw new InternalError("Error listener already set");
    this.onError = onError;
  }
  startReadLoop(onData: () => boolean | void, onEnd: () => void): void {
    this.onDataNotice = onData;
    this.onEnd = onEnd;
    const rest = this.rest;
    if (rest) {
      this.rest = undefined;
      if (this.onData(rest)) return;
    }
    this.duplex.on("data", this.onData);
    this.duplex.on("end", this.onEnd);
  }
  /**
   * 如果返回 true ，表示暂停处理数据；如果返回 false ，表示继续处理数据。
   */
  private onData = (chunk: Uint8Array): boolean => {
    while (chunk.byteLength) {
      this.gc();
      const length = this.pushReaderBufferData(chunk);
      chunk = chunk.subarray(length);

      let shouldStop = false;
      while (true) {
        const readableLength = this.readableLength;
        if (this.onDataNotice()) {
          shouldStop = true;
          break;
        }
        if (this.readableLength === readableLength) break;
      }
      if (shouldStop) {
        if (chunk.byteLength) {
          this.rest = chunk;
        }
        this.duplex.off("data", this.onData);
        this.duplex.off("end", this.onEnd);
        this.onDataNotice = noListener;
        return true;
      }
    }
    return false;
  };
  private rest?: Uint8Array;

  write(data: Uint8Array): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      this.duplex.write(data, (err) => {
        err ? reject(err) : resolve(data.byteLength);
      });
    });
  }

  closeWrite(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.duplex.end((err: unknown) => {
        err ? reject(err) : resolve();
      });
    });
  }
  destroy(): void {
    this.duplex.destroy();
  }
}
function noListener(): never {
  throw new Error("Internal Error: No listener provided");
}

export async function connectFromNodeTCP(options: PgNetConnectOptions): Promise<PgConnection> {
  const { hostname, port, ...rest } = options;
  const socket = await new Promise<Socket>((resolve, reject) => {
    const socket = connect({ port, host: hostname }, () => resolve(socket));
    socket.on("error", reject);
  });
  return createSession(socket, {
    ...rest,
    encryption: options.encryption?.map(mapEncryption),
  });
}

function mapEncryption(
  option: NonNullable<PgNetConnectOptions["encryption"]>[number],
): NonNullable<PgConnectOptions<Socket>["encryption"]>[number] {
  switch (option.mode) {
    case "TLS": {
      const caCerts = option.ca?.map((
        cert,
      ) => (typeof cert === "string" ? cert : Buffer.from(cert.buffer, cert.byteOffset, cert.byteLength)));
      return {
        mode: option.mode,
        upgradeTLS: async (conn) => {
          const tlsSocket = connectTls({
            socket: conn,
            ca: caCerts,
          });

          // 等待握手完成；握手期间的 error 会让 Promise reject。
          await once(tlsSocket, "secureConnect");
          return tlsSocket;
        },
      };
    }
    default:
      throw new InternalError(`Deno unsupported encryption mode: ${(option as any).mode}`);
  }
}
