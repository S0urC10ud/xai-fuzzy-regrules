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
    // Step 1: Remove Duplicate Rows
    const { finalX, finalY } = removeDuplicateRows(X, y, metadata.l1_row_threshold, warnings);

    // Step 2: Remove Duplicate Columns
    const { finalX: uniqueX, filteredRules } = removeDuplicateColumns(
        finalX,
        allRules,
        metadata.l1_column_threshold,
        metadata.target_var,
        warnings
    );

    // Step 3: Perform Regression
    const coeffsArray = performRegression(uniqueX, finalY, filteredRules, metadata, warnings);

    return { coeffsArray, finalX: uniqueX, finalY, filteredRules };
}
