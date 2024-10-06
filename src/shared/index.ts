import { Metadata, EvaluationMetrics, Record, Rule } from './types';
import { executeDataPipeline } from './pipeline/dataPipeline';
import { executeFeaturePipeline } from './pipeline/featurePipeline';
import { executeRulePipeline } from './pipeline/rulePipeline';
import { executeRegressionPipeline } from './pipeline/regressionPipeline';
import { executeEvaluationPipeline } from './pipeline/evaluationPipeline';
import { computeMembershipDegrees } from './utils/fuzzy';

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

    // Pipeline Step 2: Feature Engineering
    executeFeaturePipeline(records, numericalKeys, categoricalKeys, metadata, variableBounds, warnings);

    // Precompute Non-Empty Fuzzy Sets for Rule Generation
    const inputFuzzySetNonEmpty: { [variable: string]: { [fuzzySet: string]: boolean } } = {};
    numericalKeys
        .filter(key => key !== metadata.target_var)
        .forEach(key => {
            inputFuzzySetNonEmpty[key] = {};
            metadata.numerical_fuzzification.forEach(fuzzySet => {
                inputFuzzySetNonEmpty[key][fuzzySet] = records.some(
                    record => (record[`${key}_${fuzzySet}`] as number) > 0
                );
            });
        });

    const outputFuzzySetNonEmpty: { [fuzzySet: string]: boolean } = {};
    metadata.numerical_defuzzification.forEach(fuzzySet => {
        outputFuzzySetNonEmpty[fuzzySet] = false;
    });

    // Generate output universe and degrees
    const targetBounds = variableBounds[metadata.target_var];
    const targetMin = targetBounds.min;
    const targetMax = targetBounds.max;

    const outputUniverse: number[] = [];
    const numOutputPoints = 100;
    const outputStep = (targetMax - targetMin) / (numOutputPoints - 1);

    const outputFuzzySets = {
        verylow: [] as number[],
        low: [] as number[],
        mediumlow: [] as number[],
        medium: [] as number[],
        mediumhigh: [] as number[],
        high: [] as number[],
        veryhigh: [] as number[],
    };

    for (let i = 0; i < numOutputPoints; i++) {
        const value = targetMin + i * outputStep;
        outputUniverse.push(value);
        const degrees = computeMembershipDegrees(value, targetMin, targetMax);
        outputFuzzySets.verylow.push(degrees.verylow);
        outputFuzzySets.low.push(degrees.low);
        outputFuzzySets.mediumlow.push(degrees.mediumlow);
        outputFuzzySets.medium.push(degrees.medium);
        outputFuzzySets.mediumhigh.push(degrees.mediumhigh);
        outputFuzzySets.high.push(degrees.high);
        outputFuzzySets.veryhigh.push(degrees.veryhigh);
    }

    records.forEach(record => {
        const targetValue = parseFloat(record[metadata.target_var] as string);
        const degrees = computeMembershipDegrees(targetValue, targetMin, targetMax);
        Object.entries(degrees).forEach(([fuzzySet, degree]) => {
            if (degree > 0) {
                outputFuzzySetNonEmpty[fuzzySet] = true;
            }
        });
    });

    // Rule Generation
    const allRules: Rule[] = executeRulePipeline(
        numericalKeys,
        metadata.target_var,
        metadata,
        inputFuzzySetNonEmpty,
        outputFuzzySetNonEmpty,
        warnings
    );

    // Prepare feature matrix X and target vector y
    const X: number[][] = [];
    const y: number[] = records.map(record => parseFloat(record[metadata.target_var] as string));

    const ruleOutputFuzzySetDegreesMap: { [ruleIndex: number]: number[] } = {};
    allRules.forEach((rule, ruleIndex) => {
        ruleOutputFuzzySetDegreesMap[ruleIndex] = outputFuzzySets[rule.outputFuzzySet];
    });

    records.forEach(record => {
        const featureVector: number[] = [];

        allRules.forEach((rule, ruleIndex) => {
            const firingStrength = Math.min(
                ...rule.antecedents.map(ant => {
                    const key = `${ant.variable}_${ant.fuzzySet}`;
                    const value = record[key];
                    if (value === undefined || value === null) {
                        throw new Error(
                            `Invalid record: "${key}" not found or has null/undefined value in record ${JSON.stringify(record)}`
                        );
                    }
                    if (typeof value !== 'number') {
                        throw new Error(
                            `Invalid value type: "${key}" is not a number in record ${JSON.stringify(record)}`
                        );
                    }
                    return value;
                })
            );

            const outputFuzzySetDegrees = ruleOutputFuzzySetDegreesMap[ruleIndex];

            if (!outputFuzzySetDegrees) {
                throw new Error(`Output fuzzy set degrees not found for rule index ${ruleIndex}.`);
            }

            const ruleOutputMembershipDegrees = outputFuzzySetDegrees.map(degree =>
                Math.min(firingStrength, degree)
            );

            const maxMembershipDegree = Math.max(...ruleOutputMembershipDegrees);
            const indicesAtMax: number[] = [];
            ruleOutputMembershipDegrees.forEach((degree, idx) => {
                if (degree === maxMembershipDegree) indicesAtMax.push(idx);
            });

            const outputValuesAtMax = indicesAtMax.map(i => outputUniverse[i]);
            const crispOutput =
                outputValuesAtMax.reduce((sum, val) => sum + val, 0) / outputValuesAtMax.length;

            featureVector.push(crispOutput);
        });

        X.push(featureVector);
    });

    // Pipeline Step 4: Regression
    const { coeffsArray, finalX, finalY, filteredRules } = executeRegressionPipeline(
        X,
        y,
        allRules,
        metadata,
        warnings
    );

    // Step 5: Associate Coefficients with Rules
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

    // Step 6: Compute Predictions
    const y_pred = finalX.map(row => {
        return row.reduce((sum, val, idx) => sum + val * (coeffsArray ? coeffsArray[idx] : 0), 0);
    });

    // Pipeline Step 5: Evaluation
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
