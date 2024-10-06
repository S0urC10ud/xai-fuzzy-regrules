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
): void {
    encodeCategoricalVariables(records, categoricalKeys, warnings);
    fuzzifyNumericalData(records, numericalKeys, metadata.target_var, metadata, variableBounds, warnings);
}
