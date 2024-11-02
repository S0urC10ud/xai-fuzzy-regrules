import * as csv from 'csv-parse/sync';
import { Record } from '../types/index';

export function parseCSV(data: string, splitChar: string): Record[] {
    return csv.parse(data, {
        columns: true,
        delimiter: splitChar,
        skip_empty_lines: true,
    });
}
