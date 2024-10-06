// src/rules/ruleGenerator.ts

import { Rule, Metadata, Record } from '../types';
import { getCombinations, cartesianProduct } from '../utils/combinations';
import { logWarning } from '../utils/logger';

export function generateAllPossibleRules(
    numericalKeys: string[],
    targetVar: string,
    numVars: number,
    metadata: Metadata,
    inputFuzzySetNonEmpty: { [variable: string]: { [fuzzySet: string]: boolean } },
    outputFuzzySetNonEmpty: { [fuzzySet: string]: boolean },
    warnings: string[]
): Rule[] {
    let allRules: Rule[] = [];

    for (let size = 1; size <= numVars; size++) {
        const variableCombinations = getCombinations(
            numericalKeys.filter(key => key !== targetVar),
            size
        );

        variableCombinations.forEach(variableCombo => {
            const fuzzySetsPerVariable = variableCombo.map(() => metadata.numerical_fuzzification);
            const fuzzySetCombinations = cartesianProduct(...fuzzySetsPerVariable);

            fuzzySetCombinations.forEach(fuzzySetCombo => {
                const antecedents = variableCombo.map((variable, idx) => ({
                    variable,
                    fuzzySet: fuzzySetCombo[idx] as
                        | 'verylow'
                        | 'low'
                        | 'mediumlow'
                        | 'medium'
                        | 'mediumhigh'
                        | 'high'
                        | 'veryhigh',
                }));

                metadata.numerical_defuzzification.forEach(outputSet => {
                    const antecedentsNonEmpty = antecedents.every(
                        ant => inputFuzzySetNonEmpty[ant.variable][ant.fuzzySet]
                    );

                    if (antecedentsNonEmpty && outputFuzzySetNonEmpty[outputSet]) {
                        const rule: Rule = {
                            antecedents,
                            outputFuzzySet: outputSet as
                                | 'verylow'
                                | 'low'
                                | 'mediumlow'
                                | 'medium'
                                | 'mediumhigh'
                                | 'high'
                                | 'veryhigh',
                            isWhitelist: false,
                        };
                        allRules.push(rule);
                    }
                });
            });
        });
    }

    return allRules;
}