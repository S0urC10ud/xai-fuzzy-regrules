import { Record, Metadata } from '../types';
import { parseCSV } from '../dataProcessing/csvParser';
import { removeOutliers } from '../dataProcessing/outlierRemoval';
import { filterLowVarianceColumns } from '../dataProcessing/varianceFilter';
import { logWarning } from '../utils/logger';

export function executeDataPipeline(
    data: string,
    metadata: Metadata,
    warnings: string[]
): { records: Record[]; numericalKeys: string[]; categoricalKeys: string[] } {
    let records: Record[] = parseCSV(data, metadata.split_char);

    let numericalKeys: string[] = Object.keys(records[0]).filter(key => {
        return records.every(record => !isNaN(parseFloat(record[key] as string)));
    });

    const categoricalKeys: string[] = Object.keys(records[0]).filter(
        key => !numericalKeys.includes(key)
    );

    records = removeOutliers(records, numericalKeys, metadata.outlier_iqr_multiplier, warnings, metadata);

    const { filteredKeys } = filterLowVarianceColumns(
        records,
        numericalKeys,
        metadata.variance_threshold,
        metadata.target_var,
        warnings
    );
    numericalKeys = filteredKeys;

    return { records, numericalKeys, categoricalKeys };
}
