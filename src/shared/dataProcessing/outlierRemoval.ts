// src/dataProcessing/outlierRemoval.ts

import * as math from 'mathjs';
import { Record } from '../types';
import { logWarning } from '../utils/logger';

export function removeOutliers(
    records: Record[],
    numericalKeys: string[],
    iqrMultiplier: number,
    warnings: string[]
): Record[] {
    const computeIQRBounds = (values: number[], multiplier: number = 1.5): { lower: number; upper: number } => {
        const sorted = [...values].sort((a, b) => a - b);
        const q1 = math.quantileSeq(sorted, 0.25, true) as number;
        const q3 = math.quantileSeq(sorted, 0.75, true) as number;
        const iqr = q3 - q1;
        const lower = q1 - multiplier * iqr;
        const upper = q3 + multiplier * iqr;
        return { lower, upper };
    };

    const outlierBounds: { [key: string]: { lower: number; upper: number } } = {};
    numericalKeys.forEach((key) => {
        const values: number[] = records.map((record) => parseFloat(record[key] as string));
        outlierBounds[key] = computeIQRBounds(values, iqrMultiplier);
    });

    const outlierRecordIndices: Set<number> = new Set();

    numericalKeys.forEach((key) => {
        const { lower, upper } = outlierBounds[key];
        const outlierIndices = records.reduce<number[]>((acc, record, idx) => {
            const value = parseFloat(record[key] as string);
            if (lower === upper) // no difference between q1 and q3 - then interesting data might be "outliers"
                return acc;
            if (value < lower || value > upper) acc.push(idx);
            return acc;
        }, []);

        if (outlierIndices.length < 5) {
            outlierIndices.forEach((idx) => outlierRecordIndices.add(idx));
        }
    });

    const removedOutliers = outlierRecordIndices.size;
    if (removedOutliers > 0) {
        logWarning(
            `Removed ${removedOutliers} records containing outliers in columns with fewer than 5 outliers based on IQR multiplier ${iqrMultiplier}.`,
            warnings
        );
    }

    return records.filter((_, idx) => !outlierRecordIndices.has(idx));
}
