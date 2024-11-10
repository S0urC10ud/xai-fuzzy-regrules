import { Metadata, EvaluationMetrics, Rule } from './types';
import { executeDataPipeline } from './pipeline/dataPipeline';
import { executeFeaturePipeline } from './pipeline/featurePipeline';
import { executeRegressionPipeline } from './pipeline/regressionPipeline';
import { executeEvaluationPipeline } from './pipeline/evaluationPipeline';
import { prepareDefuzzification } from './pipeline/defuzzificationPipeline';
import { performInference } from './utils/fuzzy_inference';
import { executeRulePipeline } from './pipeline/rulePipeline';

function fix_scaling(x: number[], target_mean: number, target_std: number): number[] {
    return x.map(v => ((v-10) * target_std)+target_mean);
}

export function main(metadata: Metadata, data: string): EvaluationMetrics {
    const warnings: any[] = [];

    if(metadata.rule_filters.dependency_threshold > 0.1)
        warnings.push("High dependency threshold detected, consider setting this value to < 0.1 for better results.");
        
    if(metadata.lasso.regularization > 0 && metadata.rule_filters.remove_insignificant_rules)
        throw new Error("Cannot use Lasso regularization and remove insignificant rules at the same time.");

    const { records, numericalKeys, categoricalKeys, target_mean, target_std } = executeDataPipeline(data, metadata, warnings);
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

    const interestingRules = finalRules.filter(rule => rule.coefficient !== null && rule.coefficient != undefined);

    const sortedRules = interestingRules.filter(r=>!r.isIntercept).sort((a, b) => {
        if(b.coefficient === null || a.coefficient === null)
            throw new Error("Coefficient is null");
        return b.coefficient - a.coefficient
    }) as Rule[];
    const intercept = interestingRules.find(r=>r.isIntercept) as Rule;

    // Independent full double-check evaluation
    const y_pred = [];
    let regressionX: number[][];
    if (metadata.include_intercept)
         regressionX = X.map(row => [1., ...row]);
    else
        regressionX = X;

    for (let i = 0; i < regressionX.length; i++)
        y_pred.push(finalRules.reduce((sum, rule, idx) => sum + regressionX[i][rule.columnIndex] * (rule.coefficient ? rule.coefficient : 0), 0));

    const metrics = executeEvaluationPipeline(fix_scaling(y, target_mean, target_std), fix_scaling(y_pred, target_mean, target_std));

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