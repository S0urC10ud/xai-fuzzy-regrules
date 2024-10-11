import { Metadata, EvaluationMetrics } from './types';
import { executeDataPipeline } from './pipeline/dataPipeline';
import { executeFeaturePipeline } from './pipeline/featurePipeline';
import { executeRegressionPipeline } from './pipeline/regressionPipeline';
import { executeEvaluationPipeline } from './pipeline/evaluationPipeline';
import { prepareDefuzzification } from './pipeline/defuzzificationPipeline';
import { performInference } from './utils/fuzzy_inference';

export function main(metadata: Metadata, data: string): EvaluationMetrics {
    const warnings: string[] = [];

    const { records, numericalKeys, categoricalKeys } = executeDataPipeline(data, metadata, warnings);
    const variableBounds: { [key: string]: { min: number; max: number } } = {};
    numericalKeys.forEach(key => {
        const values: number[] = records.map(record => parseFloat(record[key] as string));
        const min = Math.min(...values);
        const max = Math.max(...values);
        variableBounds[key] = { min , max };
    });

    const { categoricalFuzzySets } = executeFeaturePipeline(records, numericalKeys, categoricalKeys, metadata, variableBounds, warnings);

    const { allRules, ruleOutputFuzzySetDegreesMap, outputUniverse, X, y } = prepareDefuzzification(
        numericalKeys,
        categoricalKeys,
        categoricalFuzzySets,
        metadata,
        records,
        variableBounds,
        warnings
    );

    performInference(records, allRules, ruleOutputFuzzySetDegreesMap, outputUniverse, X);

    const { coeffsArray, finalX, finalY, filteredRules } = executeRegressionPipeline(
        X,
        y,
        allRules,
        metadata,
        warnings
    );

    const ruleCoefficients = filteredRules.map((rule, index) => {
        const antecedentStr = rule.antecedents
            .map(ant => `If ${ant.variable} is ${ant.fuzzySet}`)
            .join(' AND ');
        return {
            rule: `${antecedentStr} then ${metadata.target_var} is ${rule.outputFuzzySet}`,
            coefficient: coeffsArray ? coeffsArray[index] : 0,
            isWhitelist: rule.isWhitelist,
        };
    });

    const sortedRules = ruleCoefficients.sort((a, b) => b.coefficient - a.coefficient);

    //Compute Predictions
    const y_pred = finalX.map(row => {
        return row.reduce((sum, val, idx) => sum + val * (coeffsArray ? coeffsArray[idx] : 0), 0);
    });

    const metrics = executeEvaluationPipeline(finalY, y_pred);

    return {
        ...metrics,
        warnings,
        sorted_rules: sortedRules.map(rule => ({
            rule: rule.rule,
            coefficient: rule.coefficient,
        })),
    };
}