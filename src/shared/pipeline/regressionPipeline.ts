import { Rule, Metadata } from '../types';
import { performRegression } from '../regression/regressionPipeline';
import { removeDuplicateRows, removeDuplicateColumns } from '../featureEngineering/duplicateRemoval';

export function executeRegressionPipeline(
    X: number[][],
    y: number[],
    allRules: Rule[],
    metadata: Metadata,
    warnings: any[]
): Rule[] {
    if(metadata.include_intercept) {
        X = X.map((row) => [1.0, ...row]); // Add intercept column
        let i=1;
        allRules = [new Rule([], "veryhigh", true, 0, true) , ...allRules.map(rule => new Rule(
            rule.antecedents,
            rule.outputFuzzySet,
            rule.isWhitelist,
            i++,
            false,
            rule.support,
            rule.leverage,
            rule.priority))];
    } else {
        let i=0;
        allRules = allRules.map((rule, i) => new Rule(
            rule.antecedents,
            rule.outputFuzzySet,
            rule.isWhitelist,
            i++,
            false,
            rule.support,
            rule.leverage,
            rule.priority));
    }

    const { finalX, finalY } = removeDuplicateRows(X, y, metadata.l1_row_threshold, warnings);

    const { finalX: uniqueX, filteredRules } = removeDuplicateColumns(
        finalX,
        allRules,
        metadata.l1_column_threshold,
        metadata.target_var,
        warnings
    );

    performRegression(uniqueX, finalY, filteredRules, metadata, warnings);

    return allRules;
}
