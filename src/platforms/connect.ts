import type { PgNetConnectOptions } from "@/interface/Connection.ts";
import { PgConnection } from "@/class.ts";
import { connectFromDenoTCP } from "./deno.ts";
import { connectFromNodeTCP } from "./node.ts";

/**
 * @public
 */
export async function connectFromNet(options: PgNetConnectOptions): Promise<PgConnection> {
  if (typeof globalThis.Deno !== "undefined") {
    return connectFromDenoTCP(options);
  } else {
    return connectFromNodeTCP(options);
  }
}
//TODO: 删除导出
export { connectFromNodeTCP };
