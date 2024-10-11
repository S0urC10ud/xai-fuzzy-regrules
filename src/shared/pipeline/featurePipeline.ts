import { Record, Metadata } from '../types';
import { encodeCategoricalVariables } from '../featureEngineering/encodeCategorical';
import { fuzzifyNumericalData } from '../featureEngineering/fuzzifyData';

export function executeFeaturePipeline(
    records: Record[],
    numericalKeys: string[],
    categoricalKeys: string[],
    metadata: Metadata,
    variableBounds: { [key: string]: { min: number; max: number } },
    warnings: string[]
): { categoricalFuzzySets: { [key: string]: string[] } } {
    // Set default value for enable_outlier_removal
    metadata.enable_outlier_removal = metadata.enable_outlier_removal ?? false;

    // Automatically enable outlier removal if bounds are provided
    if (metadata.outlier_bounds) {
        metadata.enable_outlier_removal = true;
    }

    const categoricalFuzzySets = encodeCategoricalVariables(records, categoricalKeys, warnings);
    fuzzifyNumericalData(records, numericalKeys, metadata.target_var, metadata, variableBounds, warnings);

    return { categoricalFuzzySets };
}