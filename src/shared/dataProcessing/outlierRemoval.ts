import { Record, Metadata } from '../types/index';

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
    target_mean: number,
    target_std: number,
    warnings: any[],
    metadata: Metadata
): Record[] {
    if (!metadata.outlier_filtering) {
        return records;
    }

    const removedCounts: { [key: string]: number } = {};
    let nullValueRemovedCount = 0;
    const offset = metadata.include_intercept ? 10 : 0;

    records = records.filter(record => {
        return numericalKeys.every(key => {
            const filterConfig = metadata.outlier_filtering![key];
            let value = Number(record[key]);
            if(key === metadata.target_var) {
                value = (value-offset)*target_std + target_mean;
            }

            if (isNaN(value)) {
                nullValueRemovedCount++;
                return false;
            }

            if (!filterConfig) {
                return true;
            }

            

            if (filterConfig.method === "IQR") {
                if(filterConfig.outlier_iqr_multiplier == undefined)
                    throw new Error("IQR filter requires outlier_iqr_multiplier value");

                let values = records.map(r => r[key]) as number[];
                if(key === metadata.target_var) {
                    values = values.map(v => (v-10)*target_std + target_mean);
                }
                const q1 = quantile(values, 0.25);
                const q3 = quantile(values, 0.75);
                const iqr = q3 - q1;
                const lowerBound = q1 - filterConfig.outlier_iqr_multiplier * iqr;
                const upperBound = q3 + filterConfig.outlier_iqr_multiplier * iqr;

                if (value < lowerBound || value > upperBound) {
                    removedCounts[key] = (removedCounts[key] || 0) + 1;
                    return false;
                }
            } else if (filterConfig.method === "VariableBounds") {
                if(filterConfig.min == undefined || filterConfig.max == undefined)
                    throw new Error("VariableBounds filter requires min and max values");
                
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

    if (nullValueRemovedCount > 0) {
        warnings.push(`Removed ${nullValueRemovedCount} rows due to null values in numerical columns`);
    }

    return records;
}
