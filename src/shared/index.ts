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

    const { outputUniverse, variableFuzzySets, inputFuzzySetNonEmpty, outputFuzzySetNonEmpty, outputFuzzySets } = prepareDefuzzification(
        numericalKeys,
        categoricalKeys,
        categoricalFuzzySets,
        metadata,
        records,
        variableBounds,
        warnings
    );

    const {allRules, ruleOutputFuzzySetDegreesMap} = executeRulePipeline(
        numericalKeys,
        categoricalKeys,
        metadata.target_var,
        metadata,
        variableFuzzySets,
        inputFuzzySetNonEmpty,
        outputFuzzySetNonEmpty,
        outputFuzzySets,
        records,
        warnings
    );
    
    const X: number[][] = [];
    const y: number[] = records.map(record => parseFloat(record[metadata.target_var] as string));

    performInference(records, allRules, ruleOutputFuzzySetDegreesMap, outputUniverse, X);

    const finalRules = executeRegressionPipeline(
        X,
        y,
        allRules,
        metadata,
        warnings
    );

    const interestingRules = finalRules.filter(rule => rule.coefficient !== 0 && rule.coefficient !== null && rule.coefficient != undefined);

    const sortedRules = interestingRules.filter(r=>!r.isIntercept).sort((a, b) => {
        if(b.coefficient === null || a.coefficient === null)
            throw new Error("Coefficient is null");
        return b.coefficient - a.coefficient
    }) as Rule[];
    const intercept = interestingRules.find(r=>r.isIntercept) as Rule;

    // Independent full double-check evaluation
    const y_pred = [];
    const regressionX = X.map(row => [1., ...row]);
    for (let i = 0; i < regressionX.length; i++)
        y_pred.push(finalRules.reduce((sum, rule, idx) => sum + regressionX[i][rule.columnIndex] * (rule.coefficient ? rule.coefficient : 0), 0));

    const metrics = executeEvaluationPipeline(y, y_pred);

    const outputRules = [];
    if(intercept!==undefined)
        outputRules.push(intercept);
    outputRules.push(...sortedRules);

    return {
        ...metrics,
        sorted_rules: outputRules.map(r=>{return {
            title: r.toString(metadata.target_var),
            coefficient: r.coefficient,
            isWhitelist: r.isWhitelist,
            support: r.support,
            leverage: r.leverage,
            priority: r.priority,
            pValue: r.pValue,
            secondaryRules: r.secondaryRules
        }}),
        warnings
    };
}