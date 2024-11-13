import * as csv from "csv-parse/sync";
import { Metadata, Record } from "../types/index";

export function parseCSV(data: string, metadata: Metadata): Record[] {
  if (metadata.decimal_point === ",") {
    const [header, ...dataLines] = data.split("\n");
    let innerData = dataLines.join("\n").replace(/,/g, ".");

    data = `${header}\n${innerData}`;
  }

  return csv.parse(data, {
    columns: true,
    delimiter: metadata.split_char,
    skip_empty_lines: true,
  });
}
