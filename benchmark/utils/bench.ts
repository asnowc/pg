import { Bench } from "tinybench";

export function createBench<T>(bench: Bench, benchFn: (data: T) => Promise<void>) {
  let aslaPg: T;

  bench.add("@asla/pg", async () => {
    await aslaPg.conn.query("select 1 as x").getRows();
  }, {
    beforeAll: async () => {
      aslaPg = await aslaConnect();
    },
    afterAll: async () => {
      await aslaPg.close();
    },
  });
}
