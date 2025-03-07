import { Rule, Metadata, FuzzySet } from '../types/index';

/**
 * Returns an array of `r` distinct random indices from 0 to n-1.
 */
function randomCombination(n: number, r: number): number[] {
  const indices = Array.from({ length: n }, (_, i) => i);
  // Shuffle the first r positions (Fisher-Yates style)
  for (let i = 0; i < r; i++) {
    const j = i + Math.floor(Math.random() * (n - i));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, r);
}

/**
 * Greedily generates a covering array for all variables (factors) where each factor’s possible levels
 * are its fuzzy sets plus a special "notUsed" value. The constraint is that each row uses only up to 
 * maxAntecedents active fuzzy set assignments (i.e. non-"notUsed" values).
 *
 * The algorithm works at pairwise (t=2) coverage. That is, for every pair of variables (i, j) and every
 * combination of fuzzy set values (for i and j, excluding "notUsed") the generated rows will cover that combo
 * at least once.
 */
function generateConstrainedCoveringArray(
  variables: string[],
  fuzzyLevels: { [variable: string]: string[] },
  maxAntecedents: number,
  iterationsPerStep: number = 1000
): string[][] {
  // Build the set of all pairs (i, j) and fuzzy-set combinations that we want to cover.
  // We only care about pairs where both variables are actively used (i.e. not "notUsed").
  const uncoveredPairs = new Set<string>();
  for (let i = 0; i < variables.length; i++) {
    for (let j = i + 1; j < variables.length; j++) {
      const levelsI = fuzzyLevels[variables[i]].filter(level => level !== 'notUsed');
      const levelsJ = fuzzyLevels[variables[j]].filter(level => level !== 'notUsed');
      for (const a of levelsI) {
        for (const b of levelsJ) {
          uncoveredPairs.add(`${i}-${j}-${a}-${b}`);
        }
      }
    }
  }

  const coveringArray: string[][] = [];
  // Continue until all required pairs are covered
  while (uncoveredPairs.size > 0) {
    let bestCandidate: string[] | null = null;
    let bestScore = 0;

    // Try several random candidates per iteration
    for (let it = 0; it < iterationsPerStep; it++) {
      // Randomly decide how many variables to “use” in this candidate (between 1 and maxAntecedents)
      const r = Math.floor(Math.random() * maxAntecedents) + 1;
      const candidateRow = new Array(variables.length).fill('notUsed');
      // Randomly choose r distinct variable positions to assign an active fuzzy set
      const selectedIndices = randomCombination(variables.length, r);
      for (const idx of selectedIndices) {
        // For each chosen variable, pick a random fuzzy set (excluding "notUsed")
        const availableLevels = fuzzyLevels[variables[idx]].filter(level => level !== 'notUsed');
        const chosenLevel = availableLevels[Math.floor(Math.random() * availableLevels.length)];
        candidateRow[idx] = chosenLevel;
      }
      // Evaluate candidate: count how many uncovered pairs it covers.
      let score = 0;
      for (let i = 0; i < variables.length; i++) {
        if (candidateRow[i] === 'notUsed') continue;
        for (let j = i + 1; j < variables.length; j++) {
          if (candidateRow[j] === 'notUsed') continue;
          const key = `${i}-${j}-${candidateRow[i]}-${candidateRow[j]}`;
          if (uncoveredPairs.has(key)) {
            score++;
          }
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidateRow;
        // Maximum possible score for r active variables is (r choose 2)
        if (score === (r * (r - 1)) / 2) {
          break;
        }
      }
    }
    if (!bestCandidate) {
      // If no candidate was found (should not normally happen), break out to avoid an infinite loop.
      break;
    }
    coveringArray.push(bestCandidate);
    // Remove the pairs covered by bestCandidate from the uncovered set.
    for (let i = 0; i < variables.length; i++) {
      if (bestCandidate[i] === 'notUsed') continue;
      for (let j = i + 1; j < variables.length; j++) {
        if (bestCandidate[j] === 'notUsed') continue;
        const key = `${i}-${j}-${bestCandidate[i]}-${bestCandidate[j]}`;
        uncoveredPairs.delete(key);
      }
    }
  }
  return coveringArray;
}

/**
 * (Helper) Validates that antecedents obey your constraints.
 * This is largely the same as your existing isValidAntecedents check.
 */
function isValidAntecedents(
  antecedents: { variable: string; fuzzySet: string }[],
  numericalKeys: string[],
  categoricalKeys: string[],
  variableFuzzySets: { [variable: string]: string[] }
): boolean {
  const allowedClasses = ["verylow", "low", "mediumlow", "medium", "mediumhigh", "high", "veryhigh"];
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
        // For categorical variables, disallow different assignments.
        if (new Set(fuzzySets).size > 1) return false;
      } else if (numericalKeys.includes(variable)) {
        // For numerical variables, ensure consecutive fuzzy set assignments (according to your ordering).
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
}

/**
 * Main function that uses the constrained covering array to generate rules.
 *
 * It constructs, for each input variable, the list of fuzzy sets available plus the extra
 * "notUsed" level. It then calls generateConstrainedCoveringArray() to get a (hopefully small)
 * set of rows. Each row is then converted into a rule by taking the non-"notUsed" entries as antecedents.
 */
export function generateRulesWithConstrainedOA(
  numericalKeys: string[],
  categoricalKeys: string[],
  targetVar: string,
  maxAntecedents: number,
  variableFuzzySets: { [variable: string]: string[] },
  inputFuzzySetNonEmpty: { [variable: string]: { [fuzzySet: string]: boolean } },
  outputFuzzySetNonEmpty: { [fuzzySet: string]: boolean },
  warnings: any[],
  metadata: Metadata
): Rule[] {
  let allRules: Rule[] = [];
  const ruleSignatures = new Set<string>();

  // Combine all input variables (excluding the target)
  const uniqueCategorical = Array.from(new Set(categoricalKeys));
  const allVariables: string[] = [
    ...numericalKeys,
    ...uniqueCategorical
  ].filter(key => key !== targetVar);

  // For each variable, the available levels are its fuzzy sets plus the special "notUsed" level.
  const fuzzyLevels: { [variable: string]: string[] } = {};
  allVariables.forEach(variable => {
    fuzzyLevels[variable] = [...(variableFuzzySets[variable] || []), "notUsed"];
  });

  // Generate a covering array that ensures (pairwise) coverage among all active variable assignments,
  // while each row uses at most maxAntecedents active variables.
  const coveringArray = generateConstrainedCoveringArray(allVariables, fuzzyLevels, maxAntecedents);

  // Convert each row of the covering array into a fuzzy IF-THEN rule.
  coveringArray.forEach(row => {
    // Build antecedents from the row: ignore positions with "notUsed"
    const antecedents = row.map((assignment, idx) => ({
      variable: allVariables[idx],
      fuzzySet: assignment
    })).filter(ant => ant.fuzzySet !== "notUsed");

    // Skip rows that did not use any variable.
    if (antecedents.length === 0) return;
    // Validate (using your existing logic).
    if (!isValidAntecedents(antecedents, numericalKeys, categoricalKeys, variableFuzzySets)) return;

    // Ensure each antecedent corresponds to a non-empty fuzzy set.
    const antecedentsNonEmpty = antecedents.every(
      ant => inputFuzzySetNonEmpty[ant.variable] && inputFuzzySetNonEmpty[ant.variable][ant.fuzzySet]
    );
    if (!antecedentsNonEmpty) return;

    // For each output fuzzy set that is non-empty, create a rule.
    metadata.numerical_defuzzification.forEach((outputSet: FuzzySet) => {
      if (outputFuzzySetNonEmpty[outputSet]) {
        // Create a unique signature (order-invariant).
        const sortedAntecedents = [...antecedents].sort((a, b) => a.variable.localeCompare(b.variable));
        const signature = sortedAntecedents.map(ant => `${ant.variable}:${ant.fuzzySet}`).join('|') + '->' + outputSet;
        if (!ruleSignatures.has(signature)) {
          const rule: Rule = new Rule(antecedents, outputSet, false);
          allRules.push(rule);
          ruleSignatures.add(signature);
        }
      }
    });
  });

  return allRules;
}
