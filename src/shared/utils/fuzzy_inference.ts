import { Record, Rule } from '../types';

export function performInference(records: Record[], allRules: Rule[], ruleOutputFuzzySetDegreesMap: { [ruleIndex: number]: number[]; }, outputUniverse: number[], X: number[][]) {
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

            const ruleOutputMembershipDegrees = outputFuzzySetDegrees.map(degree => Math.min(firingStrength, degree)
            );

            const maxMembershipDegree = Math.max(...ruleOutputMembershipDegrees);
            const indicesAtMax: number[] = [];
            ruleOutputMembershipDegrees.forEach((degree, idx) => {
                if (degree === maxMembershipDegree) indicesAtMax.push(idx);
            });

            const outputValuesAtMax = indicesAtMax.map(i => outputUniverse[i]);
            const crispOutput = outputValuesAtMax.reduce((sum, val) => sum + val, 0) / outputValuesAtMax.length;

            featureVector.push(crispOutput*firingStrength); // Weighted output value, changed defuzzification, since otherwise the antecedent would not matter and the middle would almost always be the same
        });

        X.push(featureVector);
    });
}