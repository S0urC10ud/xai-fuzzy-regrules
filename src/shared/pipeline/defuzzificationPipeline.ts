import { Metadata, EvaluationMetrics, Record, Rule } from '../types';
import { executeRulePipeline } from '../pipeline/rulePipeline';
import { computeMembershipDegrees } from '../utils/fuzzy';

export function prepareDefuzzification(
    numericalKeys: string[],
    categoricalKeys: string[],
    categoricalFuzzySets: { [key: string]: string[] },
    metadata: Metadata,
    records: Record[],
    variableBounds: { [key: string]: { min: number; max: number; }; },
    warnings: string[]
) {
    const inputFuzzySetNonEmpty: { [variable: string]: { [fuzzySet: string]: boolean; }; } = {};
    const variableFuzzySets: { [variable: string]: string[] } = {};

    numericalKeys
        .filter(key => key !== metadata.target_var)
        .forEach(key => {
            inputFuzzySetNonEmpty[key] = {};
            variableFuzzySets[key] = metadata.numerical_fuzzification;
            metadata.numerical_fuzzification.forEach(fuzzySet => {
                inputFuzzySetNonEmpty[key][fuzzySet] = records.some(
                    record => (record[`${key}_${fuzzySet}`] as number) > 0
                );
            });
        });

    categoricalKeys
        .filter(key => key !== metadata.target_var)
        .forEach(key => {
            inputFuzzySetNonEmpty[key] = {};
            const categories = categoricalFuzzySets[key];
            variableFuzzySets[key] = categories;
            categories.forEach(category => {
                inputFuzzySetNonEmpty[key][category] = records.some(
                    record => (record[`${key}_${category}`] as number) > 0
                );
            });
        });

    // Defuzzficiation Preparation
    const outputFuzzySetNonEmpty: { [fuzzySet: string]: boolean; } = {};
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
        categoricalKeys,
        metadata.target_var,
        metadata,
        variableFuzzySets,
        inputFuzzySetNonEmpty,
        outputFuzzySetNonEmpty,
        warnings
    );

    // Prepare feature matrix X and target vector y
    const X: number[][] = [];
    const y: number[] = records.map(record => parseFloat(record[metadata.target_var] as string));

    const ruleOutputFuzzySetDegreesMap: { [ruleIndex: number]: number[]; } = {};
    allRules.forEach((rule, ruleIndex) => {
        
        ruleOutputFuzzySetDegreesMap[ruleIndex] = outputFuzzySets[rule.outputFuzzySet];
    });
    return { allRules, ruleOutputFuzzySetDegreesMap, outputUniverse, X, y };
}
