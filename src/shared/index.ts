import { Metadata, EvaluationMetrics, Rule } from './types';
import { executeDataPipeline } from './pipeline/dataPipeline';
import { executeFeaturePipeline } from './pipeline/featurePipeline';
import { executeRegressionPipeline } from './pipeline/regressionPipeline';
import { executeEvaluationPipeline } from './pipeline/evaluationPipeline';
import { prepareDefuzzification } from './pipeline/defuzzificationPipeline';
import { performInference } from './utils/fuzzy_inference';
import { executeRulePipeline } from './pipeline/rulePipeline';

function fix_scaling(x: number[], target_mean: number, target_std: number): number[] {
    return x.map(v => ((v - 10) * target_std) + target_mean);
}

export function main(metadata: Metadata, data: string): EvaluationMetrics {
    const warnings: any[] = [];

    if (metadata.rule_filters.dependency_threshold > 0.1)
        warnings.push("High dependency threshold detected, consider setting this value to < 0.1 for better results.");

    if (metadata.rule_filters.remove_insignificant_rules && !metadata.compute_pvalues)
        throw new Error("Cannot remove insignificant rules without computing p-values - please activate metadata.compute_pvalues");

    const { records, numericalKeys, categoricalKeys, target_mean, target_std } = executeDataPipeline(data, metadata, warnings);
    const variableBounds: { [key: string]: { min: number; max: number } } = {};

    numericalKeys.forEach(key => {
        const values: number[] = records.map(record => parseFloat(record[key] as string));
        const min = Math.min(...values);
        const max = Math.max(...values);
        variableBounds[key] = { min, max };
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

    const { allRules, ruleOutputFuzzySetDegreesMap } = executeRulePipeline(
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

    const interestingRules = finalRules.filter(rule => rule.coefficient !== null && rule.coefficient !== undefined);

    // Sort rules by coefficient in descending order (excluding intercept)
    const sortedRules = interestingRules.filter(r => !r.isIntercept).sort((a, b) => {
        if (b.coefficient === null || a.coefficient === null)
            throw new Error("Coefficient is null");
        return b.coefficient - a.coefficient;
    }) as Rule[];

    const intercept = interestingRules.find(r => r.isIntercept) as Rule;

    // Prepare for independent full double-check evaluation
    let regressionX: number[][];
    if (metadata.include_intercept)
        regressionX = X.map(row => [1., ...row]);
    else
        regressionX = X;

    // Initialize contributions matrix: [rules][records]
    const contributions: number[][] = finalRules.map(() => new Array(regressionX.length).fill(0));

    // Calculate contributions and y_pred
    const y_pred: number[] = [];
    for (let j = 0; j < regressionX.length; j++) {
        let y_j = 0;
        for (let i = 0; i < finalRules.length; i++) {
            const coefficient = finalRules[i].coefficient ?? 0;
            const contribution = regressionX[j][finalRules[i].columnIndex] * coefficient;
            contributions[i][j] = Math.abs(contribution);
            y_j += contribution;
        }
        y_pred.push(y_j);
    }

    // Divide each rule's contributions by the sum of its contributions across all records
    if (false) {
        for (let i = 0; i < finalRules.length; i++) {
            const rowSum = contributions[i].reduce((a, b) => a + b, 0);
            if (rowSum === 0) {
                warnings.push(`Rule "${finalRules[i].toString(metadata.target_var)}" has zero total contribution.`);
                continue; // Avoid division by zero
            }
            for (let j = 0; j < regressionX.length; j++) {
                contributions[i][j] /= rowSum;
            }
        }
    } else {
        // Normalize contributions by column (record) instead of by row (rule)
        for (let j = 0; j < regressionX.length; j++) {
            const colSum = contributions.reduce((a, b) => a + b[j], 0);
            if (colSum === 0) {
                warnings.push(`Record ${j} has zero total contribution.`);
                continue; // Avoid division by zero
            }
            for (let i = 0; i < finalRules.length; i++) {
                contributions[i][j] /= colSum;
            }
        }
    }

    finalRules.forEach((rule, ruleIndex) => {
        const contributionsWithRecordIds = contributions[ruleIndex].map((contribution, recordIndex) => ({
            recordId:recordIndex,
            contribution
        }));

        const top10 = contributionsWithRecordIds
            .sort((a, b) => b.contribution - a.contribution)
            .slice(0, 10)
            .map(item => item.recordId);

        if(!rule.isIntercept)
            rule.mostContributions = top10;
    });

    const metrics = executeEvaluationPipeline(
        fix_scaling(y, target_mean, target_std),
        fix_scaling(y_pred, target_mean, target_std)
    );

    const outputRules = [];
    if (intercept !== undefined)
        outputRules.push(intercept);
    outputRules.push(...sortedRules);

    const filteredSortedRules = outputRules.filter(rule => {
        if (rule.coefficient === 0)
            return false;
        if (metadata.rule_filters.remove_insignificant_rules) {
            if (rule.pValue === null || rule.pValue === undefined)
                return false;
            return rule.pValue <= metadata.rule_filters.significance_level;
        }
        return true;
    }).map(rule => ({
        title: rule.toString(metadata.target_var),
        coefficient: rule.coefficient,
        isWhitelist: rule.isWhitelist,
        support: rule.support,
        leverage: rule.leverage,
        priority: rule.priority,
        pValue: rule.pValue,
        secondaryRules: rule.secondaryRules,
        mostAffectedCsvRows: rule.mostContributions.map(row => row + 2) // as we start counting at 0 and the first row is the header
    }));

    const return_dict = {
        ...metrics,
        sorted_rules: filteredSortedRules,
        warnings,
    }

    if (metadata.return_contributions)
        return_dict["contribution_matrix"] = contributions;

    return return_dict;
}
