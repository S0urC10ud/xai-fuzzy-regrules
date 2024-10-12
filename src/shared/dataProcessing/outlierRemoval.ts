import { Record, Metadata } from '../types';
import { logWarning } from '../utils/logger';

function quantile(arr: number[], q: number): number {
    const sorted = arr.slice().sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
        return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    } else {
        return sorted[base];
    }
}

export function removeOutliers(
    records: Record[],
    numericalKeys: string[],
    warnings: any[],
    metadata: Metadata
): Record[] {
    if (!metadata.outlier_filtering) {
        return records;
    }

    const initialLength = records.length;
    const removedCounts: { [key: string]: number } = {};

    records = records.filter(record => {
        return numericalKeys.every(key => {
            const filterConfig = metadata.outlier_filtering![key];
            if (!filterConfig) {
                return true;
            }

            const values = records.map(r => r[key]) as number[];
            const value = Number(record[key]);

            if (filterConfig.method === "IQR" && filterConfig.outlier_iqr_multiplier !== undefined) {
                const q1 = quantile(values, 0.25);
                const q3 = quantile(values, 0.75);
                const iqr = q3 - q1;
                const lowerBound = q1 - filterConfig.outlier_iqr_multiplier * iqr;
                const upperBound = q3 + filterConfig.outlier_iqr_multiplier * iqr;

                if (value < lowerBound || value > upperBound) {
                    removedCounts[key] = (removedCounts[key] || 0) + 1;
                    return false;
                }
            } else if (filterConfig.method === "VariableBounds" && filterConfig.min !== undefined && filterConfig.max !== undefined) {
                if (value < filterConfig.min || value > filterConfig.max) {
                    removedCounts[key] = (removedCounts[key] || 0) + 1;
                    return false;
                }
            }
            return true;
        });
    });

    for (const key in removedCounts) {
        warnings.push(`Removed ${removedCounts[key]} rows due to outlier filter on ${key}`);
    }

    return records;
}
