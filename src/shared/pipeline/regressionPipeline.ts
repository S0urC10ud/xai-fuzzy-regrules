import { Rule, Metadata } from '../types/index';
import { performRegression } from '../regression/regressor';
import { removeDuplicateRows, removeDuplicateColumns } from '../featureEngineering/duplicateRemoval';

export function executeRegressionPipeline(
    X: number[][],
    y: number[],
    allRules: Rule[],
    metadata: Metadata,
    warnings: any[]
): Rule[] {
    if(metadata.include_intercept !== false) {
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
        allRules = allRules.map((rule) => new Rule(
            rule.antecedents,
            rule.outputFuzzySet,
            rule.isWhitelist,
            i++,
            false,
            rule.support,
            rule.leverage,
            rule.priority));
    }

    const { finalX, finalY } = removeDuplicateRows(X, y, metadata.rule_filters.l1_row_threshold, warnings);

    const { finalX: uniqueX, filteredRules } = removeDuplicateColumns(
        finalX,
        allRules,
        metadata.rule_filters.l1_column_threshold,
        metadata.target_var,
        warnings
    );

    performRegression(uniqueX, finalY, filteredRules, metadata, warnings);

    return allRules;
}
