import { Rule, Metadata, FuzzySet } from '../types/index';
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
    // Set to keep track of generated rule signatures.
    const ruleSignatures = new Set<string>();
    
    const uniqueCategorical = Array.from(new Set(categoricalKeys));
    
    // Allow numerical variables to appear up to numVars times.
    const allVariables: string[] = [
        ...numericalKeys.flatMap(key => Array(numVars).fill(key)),
        ...uniqueCategorical
    ].filter(key => key !== targetVar);

    const allowedClasses = ["verylow", "low", "mediumlow", "medium", "mediumhigh", "high", "veryhigh"];

    // Helper: checks if antecedents are valid.
    const isValidAntecedents = (antecedents: { variable: string; fuzzySet: string }[]): boolean => {
        const groups = new Map<string, string[]>();
        antecedents.forEach(({ variable, fuzzySet }) => {
            if (!groups.has(variable)) {
                groups.set(variable, []);
            }
            groups.get(variable)!.push(fuzzySet);
        });

        for (const [variable, fuzzySets] of groups.entries()) {
            if (fuzzySets.length > 1) {
                if (categoricalKeys.includes(variable)) {
                    // Categorical: do not allow different assignments.
                    if (new Set(fuzzySets).size > 1) return false;
                } else if (numericalKeys.includes(variable)) {
                    // Numerical: use the ordering given in variableFuzzySets.
                    const ordering = variableFuzzySets[variable]
                        .filter(cls => allowedClasses.includes(cls))
                        .sort((a, b) => allowedClasses.indexOf(a) - allowedClasses.indexOf(b));
                    
                    const indices = fuzzySets.map(fs => ordering.indexOf(fs)).sort((a, b) => a - b);
                    for (let i = 1; i < indices.length; i++) {
                        if (indices[i] - indices[i - 1] !== 1) return false;
                    }
                }
            }
        }
        return true;
    };

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

                if (!isValidAntecedents(antecedents)) return;

                metadata.numerical_defuzzification.forEach((outputSet: FuzzySet) => {
                    const antecedentsNonEmpty = antecedents.every(
                        ant => inputFuzzySetNonEmpty[ant.variable][ant.fuzzySet]
                    );

                    if (antecedentsNonEmpty && outputFuzzySetNonEmpty[outputSet]) {
                        // Create a unique signature for the rule.
                        // Sorting the antecedents ensures that the order does not affect uniqueness.
                        const sortedAntecedents = [...antecedents].sort((a, b) => a.variable.localeCompare(b.variable));
                        const signature = sortedAntecedents
                            .map(ant => `${ant.variable}:${ant.fuzzySet}`)
                            .join('|') + '->' + outputSet;
                        
                        // Only add if the rule hasn't been created yet.
                        if (!ruleSignatures.has(signature)) {
                            const rule: Rule = new Rule(antecedents, outputSet, false);
                            allRules.push(rule);
                            ruleSignatures.add(signature);
                        }
                    }
                });
            });
        });
    }

    return allRules;
}
