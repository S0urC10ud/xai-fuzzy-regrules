import * as math from 'mathjs';
import { Record, Metadata } from '../types';
import { logWarning } from '../utils/logger';

export function filterLowVarianceColumns(
    records: Record[],
    numericalKeys: string[],
    varianceThreshold: number,
    targetVar: string,
    warnings: any[],
    metadata: Metadata
): { filteredKeys: string[]; updatedRecords: Record[] } {
    const computeVariance = (values: number[]): number => {
        const mean = math.mean(values);
        const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
        return math.mean(squaredDiffs);
    };

    const variances: { [key: string]: number } = {};
    numericalKeys.forEach((key) => {
        const values: number[] = records.map((record) => parseFloat(record[key] as string));
        variances[key] = computeVariance(values);
    });

    const columnsToKeep = numericalKeys.filter((key) => variances[key] >= varianceThreshold);
    const removedLowVarianceColumns = numericalKeys.length - columnsToKeep.length;

    if (removedLowVarianceColumns > 0) {
        logWarning(
            `Removed ${removedLowVarianceColumns} numeric columns with variance below ${varianceThreshold}.`,
            warnings
        );
    }

    if (metadata.remove_low_variance && !columnsToKeep.includes(targetVar)) {
        throw new Error(`The target variable '${targetVar}' was removed due to low variance.`);
    }

    if (metadata.remove_low_variance) {
        return {
            filteredKeys: columnsToKeep,
            updatedRecords: records.map(record => {
                const updatedRecord: Record = { ...record };
                numericalKeys.forEach(key => {
                    if (!columnsToKeep.includes(key)) {
                        delete updatedRecord[key];
                    }
                });
                return updatedRecord;
            }),
        };
    } else {
        numericalKeys.forEach(key => {
            if (!columnsToKeep.includes(key)) {
                logWarning(`The variable '${key}' has low variance and would have been removed.`, warnings);
            }
        });
        return {
            filteredKeys: numericalKeys,
            updatedRecords: records,
        };
    }
}
