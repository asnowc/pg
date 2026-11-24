import { InternalError } from "@/_utils/error.ts";
import type { PgConnectOptions, PgNetConnectOptions } from "@/interface/Connection.ts";
import { PgConnection } from "@/class/PgConnection.ts";

const textDecoder = new TextDecoder();

export async function connectFromDenoTCP(options: PgNetConnectOptions): Promise<PgConnection> {
  const { hostname, port, encryption, ...rest } = options;

  const stream = await Deno.connect({ hostname, port });
  return PgConnection.connect(stream, { ...rest, encryption: encryption?.map(mapEncryption) });
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
