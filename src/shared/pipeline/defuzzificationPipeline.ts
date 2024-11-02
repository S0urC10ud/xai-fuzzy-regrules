import { Metadata, Record } from '../types/index';
import { computeMembershipDegrees } from '../utils/fuzzy';

export function prepareDefuzzification(
    numericalKeys: string[],
    categoricalKeys: string[],
    categoricalFuzzySets: { [key: string]: string[] },
    metadata: Metadata,
    records: Record[],
    variableBounds: { [key: string]: { min: number; max: number; }; },
    warnings: any[]
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

    const outputFuzzySets = metadata.numerical_defuzzification.reduce((acc, fuzzySet) => {
        acc[fuzzySet] = [] as number[];
        return acc;
    }, {} as { [key: string]: number[] });

    for (let i = 0; i < numOutputPoints; i++) {
        const value = targetMin + i * outputStep;
        outputUniverse.push(value);
        const degrees = computeMembershipDegrees(value, targetMin, targetMax, metadata.numerical_defuzzification);
        metadata.numerical_defuzzification.forEach(fuzzySet => {
            outputFuzzySets[fuzzySet].push(degrees[fuzzySet]);
        });
    }

    records.forEach(record => {
        const targetValue = parseFloat(record[metadata.target_var] as string);
        const degrees = computeMembershipDegrees(targetValue, targetMin, targetMax, metadata.numerical_defuzzification);
        Object.entries(degrees).forEach(([fuzzySet, degree]) => {
            if (degree > 0) {
                outputFuzzySetNonEmpty[fuzzySet] = true;
            }
        });
    });

    return { outputUniverse, variableFuzzySets, inputFuzzySetNonEmpty, outputFuzzySetNonEmpty, outputFuzzySets };
}
