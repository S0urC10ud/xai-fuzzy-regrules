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
    const uniqueCategorical = Array.from(new Set(categoricalKeys));
    const allVariables = [...numericalKeys, ...uniqueCategorical].filter(key => key !== targetVar);

    const allowedClasses = ["verylow", "low", "mediumlow", "medium", "mediumhigh", "high", "veryhigh"];

    // Helper-Function: checks if antecedents are valid:
    // For categorical variables, ensure they’re not assigned two different fuzzy sets.
    // For numerical variables, ensure that if the same variable appears more than once,
    // its fuzzy sets (based on the provided ordering in variableFuzzySets) are neighbors.
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
                    // Categorical: all fuzzy sets must be identical
                    if (new Set(fuzzySets).size > 1) return false;
                } else if (numericalKeys.includes(variable)) {
                    // Numerical: fuzzy sets must be neighbors in the given ordering.
                    const ordering = variableFuzzySets[variable]
                        .filter(cls => allowedClasses.includes(cls))
                        .sort((a, b) => allowedClasses.indexOf(a) - allowedClasses.indexOf(b));
                    if (!ordering) continue;
                    const indices = fuzzySets.map(fs => ordering.indexOf(fs)).sort((a, b) => a - b);
                    for (let i = 1; i < indices.length; i++) {
                        if (Math.abs(indices[i] - indices[i - 1]) !== 1) return false;
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
                        const rule: Rule = new Rule(antecedents, outputSet, false);
                        allRules.push(rule);
                    }
                });
            });
        });
    }

    return allRules;
}