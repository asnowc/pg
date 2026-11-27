import { InternalError } from "@/internal/error.ts";
import { connect as connectTls } from "node:tls";
import { connect, Socket } from "node:net";
import { once } from "node:events";
import { Buffer } from "node:buffer";
import { PgConnectOptions, PgNetConnectOptions } from "@/interface/Connection.ts";
import { PgConnection } from "@/class/PgConnection.ts";

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
