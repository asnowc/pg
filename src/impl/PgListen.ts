import { PoolClient } from "../driver/mod.js";

//TODO: implement PgListen
export class PgListen implements Disposable {
  constructor(private event: string, private connect?: PoolClient) {
    if (event.includes(";")) throw new Error("event 不能包含 ';' 字符");
  }
  dispose() {
    if (!this.connect) return;
    this.connect.query("UNLISTEN " + this.event);
    this.connect = undefined;
  }
  [Symbol.dispose]() {
    this.dispose();
  }
  async [Symbol.asyncIterator]() {
    const connect = this.connect;
    if (!connect) throw new Error("Listener 已释放");
    const promise = connect.query("LISTEN " + this.event);
    connect.on("notification", (msg) => {});
  }
}
