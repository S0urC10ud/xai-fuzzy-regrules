import { Record, Metadata } from '../types';
import { parseCSV } from '../dataProcessing/csvParser';
import { removeOutliers } from '../dataProcessing/outlierRemoval';
import { filterLowVarianceColumns } from '../dataProcessing/varianceFilter';

export function executeDataPipeline(
    data: string,
    metadata: Metadata,
    warnings: any[]
): { records: Record[]; numericalKeys: string[]; categoricalKeys: string[] } {
    let records: Record[] = parseCSV(data, metadata.split_char);

    // standardize the target variable
    let target_mean = 0;
    let target_std = 1;
    const targetValues = records.map(record => parseFloat(record[metadata.target_var] as string));
    target_mean = targetValues.reduce((a, b) => a + b, 0) / targetValues.length;
    target_std = Math.sqrt(
        targetValues.reduce((a, b) => a + (b - target_mean) ** 2, 0) / targetValues.length
    );
    records = records.map(record => {
        record[metadata.target_var] = (
            (parseFloat(record[metadata.target_var] as string) - target_mean) /
            target_std
        ).toString();
        return record;
    });

    let numericalKeys: string[] = Object.keys(records[0]).filter(key => {
        return records.every(record => !isNaN(parseFloat(record[key] as string)));
    });

    const categoricalKeys: string[] = Object.keys(records[0]).filter(
        key => !numericalKeys.includes(key)
    );

    records = removeOutliers(records, numericalKeys, warnings, metadata);

    const { filteredKeys, updatedRecords } = filterLowVarianceColumns(
        records,
        numericalKeys,
        metadata.variance_threshold,
        metadata.target_var,
        warnings,
        metadata
    );
    records = updatedRecords;
    numericalKeys = filteredKeys;

    return { records, numericalKeys, categoricalKeys };
}
