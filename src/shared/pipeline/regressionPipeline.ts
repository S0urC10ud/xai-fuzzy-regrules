import { Rule, Metadata } from '../types';
import { performRegression } from '../regression/regressionPipeline';
import { removeDuplicateRows, removeDuplicateColumns } from '../featureEngineering/duplicateRemoval';
import { logWarning } from '../utils/logger';

export function executeRegressionPipeline(
    X: number[][],
    y: number[],
    allRules: Rule[],
    metadata: Metadata,
    warnings: string[]
): { coeffsArray: number[]; finalX: number[][]; finalY: number[]; filteredRules: Rule[] } {
    const { finalX, finalY } = removeDuplicateRows(X, y, metadata.l1_row_threshold, warnings);

    const { finalX: uniqueX, filteredRules } = removeDuplicateColumns(
        finalX,
        allRules,
        metadata.l1_column_threshold,
        metadata.target_var,
        warnings
    );

    const coeffsArray = performRegression(uniqueX, finalY, filteredRules, metadata, warnings);

    return { coeffsArray, finalX: uniqueX, finalY, filteredRules };
}
