import { Record } from '../types';

export function encodeCategoricalVariables(
    records: Record[],
    categoricalKeys: string[],
    warnings: string[]
): void {
    categoricalKeys.forEach(key => {
        const uniqueCategories: string[] = [...new Set(records.map(record => record[key] as string))];

        uniqueCategories.forEach(category => {
            records.forEach(record => {
                record[`${key}_${category}`] = record[key] === category ? 1 : 0;
            });
        });

        records.forEach(record => {
            delete record[key];
        });
    });
}