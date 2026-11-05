import { PgColumnDataDecoder } from "@/interface/pg_data_decoder.ts";
import { FieldInfo } from "./QueryReader.ts";

export type QueryCommonOptions = {
  /**
   * @since 0.3.0
   */
  onNotice?: (info: { notice: string }) => void;
};

export type QueryOptionsWithDecoder = {
  getResultDecoder?: (field: FieldInfo) => PgColumnDataDecoder;
};
