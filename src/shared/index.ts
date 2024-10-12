import { Metadata, EvaluationMetrics, Rule } from './types';
import { executeDataPipeline } from './pipeline/dataPipeline';
import { executeFeaturePipeline } from './pipeline/featurePipeline';
import { executeRegressionPipeline } from './pipeline/regressionPipeline';
import { executeEvaluationPipeline } from './pipeline/evaluationPipeline';
import { prepareDefuzzification } from './pipeline/defuzzificationPipeline';
import { performInference } from './utils/fuzzy_inference';
import { executeRulePipeline } from './pipeline/rulePipeline';

export function main(metadata: Metadata, data: string): EvaluationMetrics {
    const warnings: any[] = [];

    const { records, numericalKeys, categoricalKeys } = executeDataPipeline(data, metadata, warnings);
    const variableBounds: { [key: string]: { min: number; max: number } } = {};
    numericalKeys.forEach(key => {
        const values: number[] = records.map(record => parseFloat(record[key] as string));
        const min = Math.min(...values);
        const max = Math.max(...values);
        variableBounds[key] = { min , max };
    });

    const { categoricalFuzzySets } = executeFeaturePipeline(records, numericalKeys, categoricalKeys, metadata, variableBounds, warnings);

    const { outputUniverse, variableFuzzySets, inputFuzzySetNonEmpty, outputFuzzySetNonEmpty, outputFuzzySets }  = prepareDefuzzification(
        numericalKeys,
        categoricalKeys,
        categoricalFuzzySets,
        metadata,
        records,
        variableBounds,
        warnings
    );

    const {allRules,ruleOutputFuzzySetDegreesMap} = executeRulePipeline(
        numericalKeys,
        categoricalKeys,
        metadata.target_var,
        metadata,
        variableFuzzySets,
        inputFuzzySetNonEmpty,
        outputFuzzySetNonEmpty,
        outputFuzzySets,
        warnings
    );
    
    const X: number[][] = [];
    const y: number[] = records.map(record => parseFloat(record[metadata.target_var] as string));

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