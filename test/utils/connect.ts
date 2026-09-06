import { connectFromStream, type PgConnectOptions } from "@asla/pg";
import type { ByteStream } from "@/protocol.ts";
import { PUBLIC_DB_CONNECT_INFO } from "@test/utils/db.ts";

export interface TestConnectOptions extends PgConnectOptions {
  hostname?: string;
  port?: number;
  caCerts?: string[];
}

export async function denoConnect(options: TestConnectOptions) {
  const hostname = options.hostname ?? PUBLIC_DB_CONNECT_INFO.hostname ?? "127.0.0.1";
  const port = options.port ?? PUBLIC_DB_CONNECT_INFO.port ?? 5432;
  const conn = await Deno.connect({ hostname, port });
  const stream = new UpgradableDenoStream(conn);
  const tls = options.tls ?? (options.caCerts
    ? {
      mode: "require" as const,
      upgrade: () => stream.upgradeTls(hostname, options.caCerts!),
    }
    : undefined);
  return await connectFromStream(stream, { ...options, tls });
}

class UpgradableDenoStream implements ByteStream {
  constructor(private conn: Deno.TcpConn | Deno.TlsConn) {}
  private tls = false;

  async read(byteLength: number): Promise<Uint8Array> {
    const output = new Uint8Array(byteLength);
    await this.readInto(output);
    return output;
  }

  async readInto(buffer: Uint8Array): Promise<void> {
    let offset = 0;
    while (offset < buffer.byteLength) {
      const bytesRead = await this.conn.read(buffer.subarray(offset));
      if (bytesRead === null) throw new Deno.errors.UnexpectedEof();
      offset += bytesRead;
    }
  }

  write(buffer: Uint8Array): Promise<number> {
    return this.conn.write(buffer);
  }

  closeWrite(): Promise<void> {
    return this.conn.closeWrite();
  }

  close(): void {
    this.conn.close();
  }

  async upgradeTls(hostname: string, caCerts: string[]): Promise<ByteStream> {
    if (this.tls) throw new Error("Connection has already been upgraded to TLS");
    this.conn = await Deno.startTls(this.conn as Deno.TcpConn, { hostname, caCerts });
    this.tls = true;
    return this;
  }
}
