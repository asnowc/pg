import { Duplex } from "node:stream";
import type { DataStream } from "@/_utils/DataStream.ts";
import { InternalError } from "@/_utils/error.ts";
import { type ReadableBuffer, ReadBuffer } from "@/_utils/ReadBuffer.ts";
import { WriteBuffer } from "@/_utils/WriterBuffer.ts";
import { connect as connectTls } from "node:tls";
import { connect, Socket } from "node:net";
import { once } from "node:events";
import { Buffer } from "node:buffer";
import { PgConnectOptions, PgNetConnectOptions } from "@/interface/Connection.ts";
import { PgConnection } from "@/class/PgConnection.ts";

export class DuplexBufferStream extends WriteBuffer implements DataStream {
  constructor(
    private duplex: Duplex,
    options: { readBufferSize?: number; writeBufferSize?: number } = {},
  ) {
    super(
      (data) => {
        return new Promise<number>((resolve, reject) => {
          this.duplex.write(data, (err) => (err ? reject(err) : resolve(data.byteLength)));
        });
      },
      options.writeBufferSize ?? 16 * 1024,
    );
    this.reader = new ReadBuffer(new Uint8Array(options.readBufferSize ?? 16 * 1024));
  }
  private readonly reader: ReadBuffer;

  private onDataNotice: (buffer: ReadableBuffer) => boolean | void = noListener;
  private onEnd: () => void = noListener;
  private onError?: (error: Error) => void;
  listenOnError(onError?: (error: Error) => void): void {
    if (onError && this.onError) throw new InternalError("Error listener already set");
    this.onError = onError;
  }
  startReadLoop(onData: (buffer: ReadableBuffer) => boolean | void, onEnd: () => void): void {
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
    const reader = this.reader;
    while (chunk.byteLength) {
      reader.compact();
      const length = reader.pushReadBufferData(chunk);
      chunk = chunk.subarray(length);

      let shouldStop = false;
      while (true) {
        const readableLength = reader.readableLength;
        if (this.onDataNotice(reader)) {
          shouldStop = true;
          break;
        }
        if (reader.readableLength === readableLength) break;
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

  async closeWrite(): Promise<void> {
    await this.flush();
    await new Promise<void>((resolve, reject) => {
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
  return PgConnection.connect(socket, {
    ...rest,
    encryption: options.encryption?.map(mapEncryption),
  });
}

function mapEncryption(
  option: NonNullable<PgNetConnectOptions["encryption"]>[number],
): NonNullable<PgConnectOptions<Socket>["encryption"]>[number] {
  switch (option.mode) {
    case "TLS": {
      const caCerts = option.ca?.map((cert) =>
        typeof cert === "string" ? cert : Buffer.from(cert.buffer, cert.byteOffset, cert.byteLength),
      );
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
