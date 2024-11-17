import { Record, Metadata } from '../types/index';
import { parseCSV } from '../dataProcessing/csvParser';
import { removeOutliers } from '../dataProcessing/outlierRemoval';
import { filterLowVarianceColumns } from '../dataProcessing/varianceFilter';

export function executeDataPipeline(
    data: string,
    metadata: Metadata,
    warnings: any[]
): { records: Record[]; numericalKeys: string[]; categoricalKeys: string[], target_mean: number, target_std: number } {
    let records: Record[] = parseCSV(data, metadata);

    // standardize the target variable
    let target_mean = 0;
    let target_std = 1;
    const targetValues = records.map(record => parseFloat(record[metadata.target_var] as string));
    target_mean = targetValues.reduce((a, b) => a + b, 0) / targetValues.length;
    target_std = Math.sqrt(
        targetValues.reduce((a, b) => a + (b - target_mean) ** 2, 0) / targetValues.length
    );

    const offset = metadata.include_intercept ? 10 : 0;
    records = records.map(record => {
        record[metadata.target_var] = (offset + 
            (parseFloat(record[metadata.target_var] as string) - target_mean) /
            target_std
        ).toString();
        return record;
    });

    let numericalKeys: string[] = Object.keys(records[0]).filter(key => {
        return records.every(record => !isNaN(parseFloat(record[key] as string)));
    });

    if(!numericalKeys.includes(metadata.target_var)) {
        throw new Error("Target variable is not numerical - please choose another dataset or target variable");
    }

    records.forEach(r=> numericalKeys.forEach((n:string) => {
        if(metadata.decimal_point == ".") {
            if((r[n] as string).includes(",")) {
                throw new Error("Decimal point character is set to '.' but ',' is found in the dataset")
            }
        }}));

    const categoricalKeys: string[] = Object.keys(records[0]).filter(
        key => !numericalKeys.includes(key)
    );

    records = removeOutliers(records, numericalKeys, target_mean, target_std, warnings, metadata);

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

    return { records, numericalKeys, categoricalKeys, target_mean, target_std };
}
