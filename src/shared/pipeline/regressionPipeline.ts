import { Rule, Metadata } from '../types';
import { performRegression } from '../regression/regressionPipeline';
import { removeDuplicateRows, removeDuplicateColumns } from '../featureEngineering/duplicateRemoval';

export function executeRegressionPipeline(
    X: number[][],
    y: number[],
    allRules: Rule[],
    metadata: Metadata,
    warnings: any[]
): { fullParams: {coeff: number|null; pValue:number|null}[]; finalX: number[][]; finalY: number[]; filteredRules: Rule[]} {
    const { finalX, finalY } = removeDuplicateRows(X, y, metadata.l1_row_threshold, warnings);

    const { finalX: uniqueX, filteredRules } = removeDuplicateColumns(
        finalX,
        allRules,
        metadata.l1_column_threshold,
        metadata.target_var,
        warnings
    );

    const fullParams = performRegression(uniqueX, finalY, filteredRules, metadata, warnings);

    return { fullParams, finalX: uniqueX, finalY, filteredRules };
}
