import { Rule, Metadata, FuzzySet } from '../types';
import { getCombinations, cartesianProduct } from '../utils/combinations';

export function generateAllPossibleRules(
    numericalKeys: string[],
    categoricalKeys: string[],
    targetVar: string,
    numVars: number,
    variableFuzzySets: { [variable: string]: string[] },
    inputFuzzySetNonEmpty: { [variable: string]: { [fuzzySet: string]: boolean } },
    outputFuzzySetNonEmpty: { [fuzzySet: string]: boolean },
    warnings: any[],
    metadata: Metadata
): Rule[] {
    let allRules: Rule[] = [];
    const allVariables = [...numericalKeys, ...categoricalKeys].filter(key => key !== targetVar);

    for (let size = 1; size <= numVars; size++) {
        const variableCombinations = getCombinations(allVariables, size);

        variableCombinations.forEach(variableCombo => {
            const fuzzySetsPerVariable = variableCombo.map(variable => variableFuzzySets[variable]);
            const fuzzySetCombinations = cartesianProduct(...fuzzySetsPerVariable);

            fuzzySetCombinations.forEach(fuzzySetCombo => {
                const antecedents = variableCombo.map((variable, idx) => ({
                    variable,
                    fuzzySet: fuzzySetCombo[idx]
                }));

                metadata.numerical_defuzzification.forEach((outputSet: FuzzySet) => {
                    const antecedentsNonEmpty = antecedents.every(
                        ant => inputFuzzySetNonEmpty[ant.variable][ant.fuzzySet]
                    );

                    if (antecedentsNonEmpty && outputFuzzySetNonEmpty[outputSet]) {
                        const rule: Rule = {
                            antecedents,
                            outputFuzzySet: outputSet,
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
