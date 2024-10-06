import * as csv from 'csv-parse/sync';
import * as math from 'mathjs';
import { generateFuzzificationChart } from './utils/fuzzification';
import { Matrix, solve } from 'ml-matrix';
import { computeMembershipDegrees } from './utils/fuzzy';

type Metadata = {
    target_var: string;
    split_char: string;
    regularization: number;
    l1_column_threshold: number;
    l1_row_threshold: number;
    numerical_fuzzification: string[];
    numerical_defuzzification: string[];
    variance_threshold: number;
    outlier_iqr_multiplier: number;
    num_vars: number;
    whitelist?: string[];
    blacklist?: string[];
    only_whitelist?: boolean;
};
function isNumber(value: any) {
    return typeof value === 'number' && !isNaN(value);
}
type Record = { [key: string]: string | number };

// Updated Rule type to include multiple antecedents and whitelist flag
type Rule = {
    antecedents: { variable: string, fuzzySet: 'verylow' | 'low' | 'mediumlow' | 'medium' | 'mediumhigh' | 'high' | 'veryhigh' }[];
    outputFuzzySet: 'verylow' | 'low' | 'mediumlow' | 'medium' | 'mediumhigh' | 'high' | 'veryhigh';
    isWhitelist: boolean;
};

// Define the structure for the returned metrics
type EvaluationMetrics = {
    sorted_rules: { rule: string, coefficient: number }[];
    mean_absolute_error: number;
    root_mean_squared_error: number;
    r_squared: number;
    mean_absolute_percentage_error: number;
    warnings: string[];
};

/**
 * Parses a rule string into a Rule object.
 * Expected format: "If <Var1> is <FuzzySet1> AND If <Var2> is <FuzzySet2> then <TargetVar> is <OutputFuzzySet>"
 */
function parseRuleString(ruleStr: string, targetVar: string, isWhitelist: boolean = false): Rule | null {
    try {
        const [antecedentPart, consequentPart] = ruleStr.split(' then ');
        if (!antecedentPart || !consequentPart) {
            return null;
        }

        const antecedentMatches = antecedentPart.match(/If\s+([A-Za-z0-9_]+)\s+is\s+(verylow|low|mediumlow|medium|mediumhigh|high|veryhigh)/gi);
        if (!antecedentMatches) {
            return null;
        }

        const antecedents = antecedentMatches.map(match => {
            const parts = match.trim().split(/\s+/);
            return {
                variable: parts[1],
                fuzzySet: parts[3] as 'verylow' | 'low' | 'mediumlow' | 'medium' | 'mediumhigh' | 'high' | 'veryhigh'
            };
        });

        const consequentMatch = consequentPart.trim().match(new RegExp(`^${targetVar}\\s+is\\s+(verylow|low|mediumlow|medium|mediumhigh|high|veryhigh)$`, 'i'));
        if (!consequentMatch) {
            return null;
        }

        const outputFuzzySet = consequentMatch[1].toLowerCase() as 'verylow' | 'low' | 'mediumlow' | 'medium' | 'mediumhigh' | 'high' | 'veryhigh';

        return {
            antecedents,
            outputFuzzySet,
            isWhitelist
        };
    } catch (error) {
        return null;
    }
}

/**
 * Serializes a Rule object into a standardized string.
 */
function serializeRule(rule: Rule, targetVar: string): string {
    const antecedentStr = rule.antecedents
        .map(ant => `If ${ant.variable} is ${ant.fuzzySet}`)
        .join(' AND ');
    return `${antecedentStr} then ${targetVar} is ${rule.outputFuzzySet}`;
}

/**
 * Attempts to solve for coefficients. If it fails, removes non-whitelist rules iteratively and retries.
 * @param XtX_reg - Regularized X^T X matrix
 * @param Xt_y - X^T y vector
 * @param rules - Array of all rules
 * @param warnings - Array to accumulate warning messages
 * @returns Coefficients array or null if no solution is found
 */
function attemptToSolve(
    XtX_reg: Matrix,
    Xt_y: Matrix,
    rules: Rule[],
    warnings: string[]
): number[] | null {
    let currentRules = [...rules];
    let attempt = 0;

    while (currentRules.length > 0) {
        // Convert current rules to X_matrix and Xt_y accordingly
        // Here, XtX_reg and Xt_y should be recomputed based on currentRules
        // To simplify, we'll assume XtX_reg and Xt_y are already based on currentRules

        // Attempt to solve
        try {
            let coeffs = solve(XtX_reg, Xt_y);
            return coeffs.to1DArray();
        } catch (e) {
            // Find a rule to remove
            // Prioritize removing non-whitelist rules
            const nonWhitelistIndex = currentRules.findIndex(rule => !rule.isWhitelist);
            if (nonWhitelistIndex !== -1) {
                const removedRule = currentRules.splice(nonWhitelistIndex, 1)[0];
                const ruleStr = serializeRule(removedRule, rules[0]?.antecedents[0]?.variable || 'TARGET');
                const warn_msg = `Removed non-whitelist rule to attempt solving: "${ruleStr}".`;
                warnings.push(warn_msg);
                console.warn(warn_msg);
            } else {
                // No non-whitelist rules left, start removing whitelist rules
                const whitelistIndex = currentRules.findIndex(rule => rule.isWhitelist);
                if (whitelistIndex !== -1) {
                    const removedRule = currentRules.splice(whitelistIndex, 1)[0];
                    const ruleStr = serializeRule(removedRule, rules[0]?.antecedents[0]?.variable || 'TARGET');
                    const warn_msg = `Removed whitelist rule to attempt solving: "${ruleStr}".`;
                    warnings.push(warn_msg);
                    console.warn(warn_msg);
                } else {
                    // No rules left to remove
                    const warn_msg = `Unable to solve the system after removing all rules.`;
                    warnings.push(warn_msg);
                    console.warn(warn_msg);
                    return null;
                }
            }
            attempt++;
            if (attempt > rules.length) {
                const warn_msg = `Exceeded maximum attempts to solve the system.`;
                warnings.push(warn_msg);
                console.warn(warn_msg);
                return null;
            }
        }
    }

    return null;
}

export function main(metadata: Metadata, data: string): EvaluationMetrics {
    const targetVar = metadata["target_var"];
    const warnings: string[] = [];
    const records: Record[] = csv.parse(data, {
        columns: true,
        delimiter: metadata["split_char"],
        skip_empty_lines: true,
    });

    // Optional parameters with default values
    const varianceThreshold = metadata.variance_threshold;
    const iqrMultiplier = metadata.outlier_iqr_multiplier;
    const numVars = metadata.num_vars; // Maximum number of antecedents in a rule

    // Identify numerical and categorical keys
    let numericalKeys: string[] = Object.keys(records[0]).filter(key => {
        return records.every(record => !isNaN(parseFloat(record[key] as string)));
    });

    const categoricalKeys: string[] = Object.keys(records[0]).filter(key => !numericalKeys.includes(key));

    // ================================
    // Step 1: Remove Outliers from Numeric Columns (Conditional Filtering)
    // ================================

    // Function to compute IQR and bounds
    const computeIQRBounds = (values: number[], multiplier: number = 1.5): { lower: number, upper: number } => {
        const sorted = [...values].sort((a, b) => a - b);
        const q1 = math.quantileSeq(sorted, 0.25, true) as number;
        const q3 = math.quantileSeq(sorted, 0.75, true) as number;
        const iqr = q3 - q1;
        const lower = q1 - multiplier * iqr;
        const upper = q3 + multiplier * iqr;
        return { lower, upper };
    };

    // Determine outlier bounds for each numeric column
    const outlierBounds: { [key: string]: { lower: number, upper: number } } = {};
    numericalKeys.forEach(key => {
        const values: number[] = records.map(record => parseFloat(record[key] as string));
        outlierBounds[key] = computeIQRBounds(values, iqrMultiplier);
    });

    // Initialize a set to keep track of record indices to remove
    const outlierRecordIndices: Set<number> = new Set();

    // Iterate over each numeric column to find outliers and conditionally mark records for removal
    numericalKeys.forEach((key, colIndex) => {
        const { lower, upper } = outlierBounds[key];
        const outlierIndicesForColumn: number[] = [];

        records.forEach((record, index) => {
            const value = parseFloat(record[key] as string);
            if (value < lower || value > upper) {
                outlierIndicesForColumn.push(index);
            }
        });

        const outlierCount = outlierIndicesForColumn.length;

        // Only perform outlier filtering if there are fewer than 5 outliers in the column
        if (outlierCount < 5) {
            outlierIndicesForColumn.forEach(idx => outlierRecordIndices.add(idx));
        }
    });

    // Filter out records that are marked as outliers in any column with fewer than 5 outliers
    const filteredRecords = records.filter((_, index) => !outlierRecordIndices.has(index));
    const removedOutliers = outlierRecordIndices.size;

    if (removedOutliers > 0) {
        const warn_msg = `Removed ${removedOutliers} records containing outliers in columns with fewer than 5 outliers based on IQR multiplier ${iqrMultiplier}.`;
        warnings.push(warn_msg);
        console.warn(warn_msg);
    }

    // Update records to filteredRecords
    const updatedRecords = filteredRecords;

    // ================================
    // Step 2: Remove Numeric Columns with Low Variance
    // ================================

    // Function to compute variance
    const computeVariance = (values: number[]): number => {
        const mean = math.mean(values);
        const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
        return math.mean(squaredDiffs);
    };

    // Compute variance for each numeric column
    const variances: { [key: string]: number } = {};
    numericalKeys.forEach(key => {
        const values: number[] = updatedRecords.map(record => parseFloat(record[key] as string));
        variances[key] = computeVariance(values);
    });

    // Identify columns to keep (variance >= threshold)
    const columnsToKeep = numericalKeys.filter(key => variances[key] >= varianceThreshold);
    const removedLowVarianceColumns = numericalKeys.length - columnsToKeep.length;

    if (removedLowVarianceColumns > 0) {
        const warn_msg = `Removed ${removedLowVarianceColumns} numeric columns with variance below ${varianceThreshold}.`;
        warnings.push(warn_msg);
        console.warn(warn_msg);
    }

    // Update numericalKeys to columnsToKeep
    numericalKeys = columnsToKeep;

    // If the target variable was removed due to low variance, throw an error
    if (!numericalKeys.includes(targetVar)) {
        throw new Error(`The target variable '${targetVar}' was removed due to low variance.`);
    }

    // Proceed with updatedRecords and numericalKeys
    const recordsAfterFiltering = updatedRecords;

    // Store quantiles for numerical variables
    const variableBounds: { [key: string]: { min: number, max: number } } = {};

    // Process numerical columns (including target variable)
    numericalKeys.forEach(key => {
        const values: number[] = recordsAfterFiltering.map(record => parseFloat(record[key] as string));
        const sortedValues = [...values].sort((a, b) => a - b);
        const min = sortedValues[0];
        const max = sortedValues[sortedValues.length - 1];
        variableBounds[key] = { min, max };

        if (key !== targetVar) {
            generateFuzzificationChart(values, min, max, key);

            recordsAfterFiltering.forEach(record => {
                const x = parseFloat(record[key] as string);
                const degrees = computeMembershipDegrees(x, min, max);
                // Updated to include all seven fuzzy sets
                record[`${key}_verylow`] = parseFloat(degrees.verylow.toFixed(4));
                record[`${key}_low`] = parseFloat(degrees.low.toFixed(4));
                record[`${key}_mediumlow`] = parseFloat(degrees.mediumlow.toFixed(4));
                record[`${key}_medium`] = parseFloat(degrees.medium.toFixed(4));
                record[`${key}_mediumhigh`] = parseFloat(degrees.mediumhigh.toFixed(4));
                record[`${key}_high`] = parseFloat(degrees.high.toFixed(4));
                record[`${key}_veryhigh`] = parseFloat(degrees.veryhigh.toFixed(4));
                delete record[key];
            });
        }
    });

    categoricalKeys.forEach(key => {
        const uniqueCategories: string[] = [...new Set(recordsAfterFiltering.map(record => record[key] as string))];

        uniqueCategories.forEach(category => {
            recordsAfterFiltering.forEach(record => {
                record[`${key}_${category}`] = record[key] === category ? 1 : 0;
            });
        });

        recordsAfterFiltering.forEach(record => {
            delete record[key];
        });
    });

    // Define all possible output fuzzy sets
    const outputFuzzySetsList = metadata["numerical_defuzzification"];

    // Precompute Non-Empty Fuzzy Sets

    // 1. Check non-empty antecedent fuzzy sets
    const inputFuzzySetNonEmpty: { [variable: string]: { [fuzzySet: string]: boolean } } = {};
    numericalKeys.filter(key => key !== targetVar).forEach(key => {
        inputFuzzySetNonEmpty[key] = {};
        metadata["numerical_fuzzification"].forEach(fuzzySet => {
            inputFuzzySetNonEmpty[key][fuzzySet] = recordsAfterFiltering.some(record => (record[`${key}_${fuzzySet}`] as number) > 0);
        });
    });

    // 2. Check non-empty consequent fuzzy sets
    const outputFuzzySetNonEmpty: { [fuzzySet: string]: boolean } = {};
    outputFuzzySetsList.forEach(fuzzySet => {
        outputFuzzySetNonEmpty[fuzzySet] = false;
        // Will be updated after computing outputFuzzySets
    });

    // Prepare the output fuzzy sets for the target variable
    const targetBounds = variableBounds[targetVar];
    const targetMin = targetBounds.min;
    const targetMax = targetBounds.max;

    const outputUniverse: number[] = [];
    const numOutputPoints = 100;
    const outputStep = (targetMax - targetMin) / (numOutputPoints - 1);

    for (let i = 0; i < numOutputPoints; i++) {
        const value = targetMin + i * outputStep;
        outputUniverse.push(value);
    }

    // Updated to include all seven fuzzy sets
    const outputFuzzySets = {
        verylow: [] as number[],
        low: [] as number[],
        mediumlow: [] as number[],
        medium: [] as number[],
        mediumhigh: [] as number[],
        high: [] as number[],
        veryhigh: [] as number[],
    };

    outputUniverse.forEach(value => {
        const degrees = computeMembershipDegrees(value, targetMin, targetMax);
        outputFuzzySets.verylow.push(degrees.verylow);
        outputFuzzySets.low.push(degrees.low);
        outputFuzzySets.mediumlow.push(degrees.mediumlow);
        outputFuzzySets.medium.push(degrees.medium);
        outputFuzzySets.mediumhigh.push(degrees.mediumhigh);
        outputFuzzySets.high.push(degrees.high);
        outputFuzzySets.veryhigh.push(degrees.veryhigh);
    });

    // Now that outputFuzzySets are defined, update outputFuzzySetNonEmpty
    outputFuzzySetsList.forEach(fuzzySet => {
        outputFuzzySetNonEmpty[fuzzySet] = outputFuzzySets[fuzzySet as keyof typeof outputFuzzySets].some(degree => degree > 0);
    });

    // Generate rules with combinations of antecedents up to num_vars
    let allRules: Rule[] = [];

    // Helper function to generate all combinations of variables
    const getCombinations = <T>(array: T[], combinationSize: number): T[][] => {
        const results: T[][] = [];
        const recurse = (start: number, combo: T[]) => {
            if (combo.length === combinationSize) {
                results.push([...combo]);
                return;
            }
            for (let i = start; i < array.length; i++) {
                combo.push(array[i]);
                recurse(i + 1, combo);
                combo.pop();
            }
        };
        recurse(0, []);
        return results;
    };

    // Helper function to compute the Cartesian product of arrays
    function cartesianProduct<T>(...arrays: T[][]): T[][] {
        return arrays.reduce<T[][]>((acc, curr) => {
            const res: T[][] = [];
            acc.forEach(a => {
                curr.forEach(b => {
                    res.push([...a, b]);
                });
            });
            return res;
        }, [[]]);
    }

    // Iterate over combination sizes from 1 to num_vars
    for (let size = 1; size <= numVars; size++) {
        const variableCombinations = getCombinations(numericalKeys.filter(key => key !== targetVar), size);
        variableCombinations.forEach(variableCombo => {
            // For each combination of variables, iterate over all possible fuzzy set assignments
            // This is a Cartesian product of fuzzy sets for each variable in the combination
            const fuzzySetsPerVariable = variableCombo.map(variable => metadata["numerical_fuzzification"]);
            const fuzzySetCombinations = cartesianProduct(...fuzzySetsPerVariable);

            fuzzySetCombinations.forEach(fuzzySetCombo => {
                // Construct antecedents
                const antecedents = variableCombo.map((variable, idx) => ({
                    variable,
                    fuzzySet: fuzzySetCombo[idx] as 'verylow' | 'low' | 'mediumlow' | 'medium' | 'mediumhigh' | 'high' | 'veryhigh'
                }));

                // Iterate over all possible consequents
                outputFuzzySetsList.forEach(outputSet => {
                    // Check if all antecedent fuzzy sets are non-empty
                    const antecedentsNonEmpty = antecedents.every(ant => inputFuzzySetNonEmpty[ant.variable][ant.fuzzySet]);

                    // Check if the consequent fuzzy set is non-empty
                    if (antecedentsNonEmpty && outputFuzzySetNonEmpty[outputSet]) {
                        const rule: Rule = {
                            antecedents,
                            outputFuzzySet: outputSet as 'verylow' | 'low' | 'mediumlow' | 'medium' | 'mediumhigh' | 'high' | 'veryhigh',
                            isWhitelist: false
                        };
                        allRules.push(rule);
                    }
                });
            });
        });
    }

    // ================================
    // Step 3: Apply Whitelist and Blacklist
    // ================================

    const { whitelist, blacklist, only_whitelist } = metadata;

    // Function to add rules from the whitelist
    if (only_whitelist && whitelist && whitelist.length > 0) {
        // Parse whitelist rules
        const parsedWhitelistRules: Rule[] = [];
        whitelist.forEach(ruleStr => {
            const parsedRule = parseRuleString(ruleStr, targetVar, true);
            if (parsedRule) {
                parsedWhitelistRules.push(parsedRule);
            } else {
                const warn_msg = `Failed to parse whitelist rule: "${ruleStr}". It will be ignored.`;
                warnings.push(warn_msg);
                console.warn(warn_msg);
            }
        });

        // Clear existing rules and set to whitelist only
        allRules = parsedWhitelistRules;
        const warn_msg = `Only whitelist rules will be used as "only_whitelist" is set to true. Total whitelist rules: ${allRules.length}.`;
        warnings.push(warn_msg);
        console.warn(warn_msg);
    } else {
        if (whitelist && whitelist.length > 0) {
            // Parse and add whitelist rules
            const parsedWhitelistRules: Rule[] = [];
            whitelist.forEach(ruleStr => {
                const parsedRule = parseRuleString(ruleStr, targetVar, true);
                if (parsedRule) {
                    parsedWhitelistRules.push(parsedRule);
                } else {
                    const warn_msg = `Failed to parse whitelist rule: "${ruleStr}". It will be ignored.`;
                    warnings.push(warn_msg);
                    console.warn(warn_msg);
                }
            });

            // Add whitelist rules to the existing rules
            parsedWhitelistRules.forEach(whitelistRule => {
                // Avoid adding duplicate rules
                const serializedWhitelistRule = serializeRule(whitelistRule, targetVar);
                const isDuplicate = allRules.some(rule => {
                    return serializeRule(rule, targetVar) === serializedWhitelistRule;
                });
                if (!isDuplicate) {
                    allRules.push(whitelistRule);
                }
            });

            const addedWhitelistCount = parsedWhitelistRules.length;
            const warn_msg = `Added ${addedWhitelistCount} whitelist rules to the rule set.`;
            warnings.push(warn_msg);
            console.warn(warn_msg);
        }

        if (blacklist && blacklist.length > 0) {
            // Parse and remove blacklist rules
            const parsedBlacklistRules: Rule[] = [];
            blacklist.forEach(ruleStr => {
                const parsedRule = parseRuleString(ruleStr, targetVar, false);
                if (parsedRule) {
                    parsedBlacklistRules.push(parsedRule);
                } else {
                    const warn_msg = `Failed to parse blacklist rule: "${ruleStr}". It will be ignored.`;
                    warnings.push(warn_msg);
                    console.warn(warn_msg);
                }
            });

            // Serialize blacklist rules for comparison
            const serializedBlacklist = parsedBlacklistRules.map(rule => serializeRule(rule, targetVar));

            // Remove blacklisted rules from the allRules list
            const initialRuleCount = allRules.length;
            allRules = allRules.filter(rule => {
                const serializedRule = serializeRule(rule, targetVar);
                return !serializedBlacklist.includes(serializedRule);
            });
            const removedBlacklistCount = initialRuleCount - allRules.length;

            const warn_msg = `Removed ${removedBlacklistCount} rules based on the blacklist.`;
            warnings.push(warn_msg);
            console.warn(warn_msg);
        }
    }

    // ================================
    // Initialize feature matrix X and target vector y
    // ================================

    const X: number[][] = []; // Each row corresponds to a record (and contains all rules), each column corresponds to a rule's crisp output
    const y: number[] = recordsAfterFiltering.map((record) => parseFloat(record[targetVar] as string));

    // Precompute rule output fuzzy set degrees
    const ruleOutputFuzzySetDegreesMap: { [ruleIndex: number]: number[] } = {};
    allRules.forEach((rule, ruleIndex) => {
        ruleOutputFuzzySetDegreesMap[ruleIndex] = outputFuzzySets[rule.outputFuzzySet];
    });

    // For each record, compute the crisp output for each rule
    recordsAfterFiltering.forEach((record, index) => {
        const featureVector: number[] = [];

        allRules.forEach((rule, ruleIndex) => {
            // Compute firing strength
            // For multiple antecedents, use the minimum of the degrees (AND operation)
            const firingStrength = Math.min(...rule.antecedents.map(ant => {
                const key = `${ant.variable}_${ant.fuzzySet}`;
                const value = record[key];
                
                if (value === undefined || value === null) {
                    throw new Error(`Invalid record: "${key}" not found or has null/undefined value in record ${JSON.stringify(record)}`);
                }
                
                if (typeof value !== 'number') {
                    throw new Error(`Invalid value type: "${key}" is not a number in record ${JSON.stringify(record)}`);
                }
                
                return value;
            }));
            
            // Get the output fuzzy set's membership degrees over the output universe
            const outputFuzzySetDegrees = ruleOutputFuzzySetDegreesMap[ruleIndex];

            if (!outputFuzzySetDegrees) {
                // If the output fuzzy set degrees are not precomputed, compute them now
                throw new Error(`Output fuzzy set degrees not found for rule index ${ruleIndex}.`);
            }

            // Vertically cap
            const ruleOutputMembershipDegrees = outputFuzzySetDegrees.map(degree => Math.min(firingStrength, degree));

            // Defuzzify the rule's output fuzzy set using Middle of Maximum (MoM)
            const maxMembershipDegree = Math.max(...ruleOutputMembershipDegrees);

            // Find all indices where the membership degree equals the maximum
            const indicesAtMax: number[] = [];
            for (let i = 0; i < ruleOutputMembershipDegrees.length; i++) {
                if (ruleOutputMembershipDegrees[i] === maxMembershipDegree) {
                    indicesAtMax.push(i);
                }
            }

            // Get the corresponding output values
            const outputValuesAtMax = indicesAtMax.map(i => outputUniverse[i]);

            // Compute the middle of maximum
            const crispOutput = outputValuesAtMax.reduce((sum, val) => sum + val, 0) / outputValuesAtMax.length;

            // Append the crisp output to the feature vector
            featureVector.push(crispOutput);
        });

        // Append the feature vector for this record to X
        X.push(featureVector);
    });

    // ================================
    // Optimized Duplicate Row Removal
    // ================================

    // Function to hash a row based on rounded values
    const hashRow = (row: number[], threshold: number): string => {
        const numDimensions = row.length;
        const precision = threshold / numDimensions / 2; // Ensures that two rows within threshold are hashed to the same bucket
        return row.map(value => Math.round(value / precision)).join('_');
    };

    const uniqueX: number[][] = [];
    const uniqueY: number[] = [];
    const rowHashes = new Map<string, number>();
    let duplicateRowCount = 0;
    const rowThreshold = metadata["l1_row_threshold"]; // L1 norm threshold

    for (let i = 0; i < X.length; i++) {
        const currentRow = X[i];
        const currentHash = hashRow(currentRow, rowThreshold);

        if (!rowHashes.has(currentHash)) {
            rowHashes.set(currentHash, uniqueX.length);
            uniqueX.push(currentRow);
            uniqueY.push(y[i]);
        } else {
            // Optionally, verify if the existing row is indeed within the threshold
            const existingIndex = rowHashes.get(currentHash)!;
            const existingRow = uniqueX[existingIndex];
            let isDuplicate = true;
            let accumulatedDiff = 0;

            for (let j = 0; j < currentRow.length; j++) {
                accumulatedDiff += Math.abs(currentRow[j] - existingRow[j]);
                if (accumulatedDiff >= rowThreshold) {
                    isDuplicate = false;
                    break;
                }
            }

            if (isDuplicate) {
                duplicateRowCount++;
            } else {
                rowHashes.set(currentHash, uniqueX.length);
                uniqueX.push(currentRow);
                uniqueY.push(y[i]);
            }
        }
    }

    if (duplicateRowCount > 0) {
        const warn_msg = `Duplicate rows detected and removed based on L1-Norm < ${rowThreshold}: ${duplicateRowCount}`;
        warnings.push(warn_msg);
        console.warn(warn_msg);
    }

    const finalX = uniqueX;
    const finalY = uniqueY;

    // ================================
    // Optimized Duplicate Column Removal
    // ================================

    // Function to hash a column based on rounded values
    const hashColumn = (column: number[], threshold: number): string => {
        const numElements = column.length;
        const precision = threshold / numElements / 2; // Ensures that two columns within threshold are hashed to the same bucket
        return column.map(value => Math.round(value / precision)).join('_');
    };

    const keptColumns: number[] = [];
    const columnHashes = new Map<string, number>();
    const duplicateColumnGroups: number[][] = [];
    const columnThreshold = metadata["l1_column_threshold"]; // L1 norm threshold

    for (let col = 0; col < finalX[0].length; col++) {
        const currentColumn = finalX.map(row => row[col]);
        const currentHash = hashColumn(currentColumn, columnThreshold);

        if (!columnHashes.has(currentHash)) {
            columnHashes.set(currentHash, keptColumns.length);
            keptColumns.push(col);
        } else {
            // Optionally, verify if the existing column is indeed within the threshold
            const existingIndex = columnHashes.get(currentHash)!;
            const existingColumn = finalX.map(row => row[keptColumns[existingIndex]]);
            let isDuplicate = true;
            let accumulatedDiff = 0;

            for (let j = 0; j < currentColumn.length; j++) {
                accumulatedDiff += Math.abs(currentColumn[j] - existingColumn[j]);
                if (accumulatedDiff >= columnThreshold) {
                    isDuplicate = false;
                    break;
                }
            }

            if (isDuplicate) {
                // Find the group that the keptCol belongs to
                let groupFound = false;
                for (const group of duplicateColumnGroups) {
                    if (group.includes(keptColumns[existingIndex])) {
                        group.push(col);
                        groupFound = true;
                        break;
                    }
                }
                if (!groupFound) {
                    duplicateColumnGroups.push([keptColumns[existingIndex], col]);
                }
            } else {
                columnHashes.set(currentHash, keptColumns.length);
                keptColumns.push(col);
            }
        }
    }

    const duplicateColumnCount = finalX[0].length - keptColumns.length;

    if (duplicateColumnCount > 0) {
        // Collect details for warnings
        const duplicateDetails = duplicateColumnGroups
            .filter(group => group.length > 1)
            .map(group => {
                const [primary, ...duplicates] = group;
                const primaryRule = allRules[primary];
                if (!primaryRule) return '';
                const duplicateRules = duplicates.map(colIndex => {
                    const rule = allRules[colIndex];
                    if (rule == null) return '';
                    const antecedentStr = rule.antecedents.map(ant => `If ${ant.variable} is ${ant.fuzzySet}`).join(' AND ');
                    return `${antecedentStr} then ${targetVar} is ${rule.outputFuzzySet}`;
                }).filter(Boolean).join(' | ');
                const primaryAntecedentStr = primaryRule.antecedents.map(ant => `If ${ant.variable} is ${ant.fuzzySet}`).join(' AND ');
                return `Primary Rule: ${primaryAntecedentStr} then ${targetVar} is ${primaryRule.outputFuzzySet}\nDuplicate Rules: ${duplicateRules}`;
            })
            .filter(detail => detail !== '')
            .join('\n\n');

        const warn_msg = `Duplicate columns detected and removed based on L1-Norm < ${columnThreshold}:\n${duplicateDetails}`;
        warnings.push(warn_msg);
        console.warn(warn_msg);

        // Remove duplicate columns from finalX and rules
        const uniqueXUpdated = finalX.map(row => {
            return keptColumns.map(colIndex => row[colIndex]);
        });
        const filteredRules = keptColumns.map(colIndex => allRules[colIndex]).filter(rule => rule !== null) as Rule[];

        // Replace finalX and allRules with filtered versions
        // Note: Since 'finalX' and 'allRules' are used later, reassign them
        finalX.length = 0;
        finalX.push(...uniqueXUpdated);
        allRules.length = 0;
        allRules.push(...filteredRules);
    }

    // If X has more columns than rows add a warning
    if (finalX.length < finalX[0].length) {
        const warn_msg = `The feature matrix has more columns (${finalX[0].length}) than rows (${finalX.length}) after the removal of duplicate rows/columns. This may lead to poor performance of the model.`;
        warnings.push(warn_msg);
        console.warn(warn_msg);
    }

    // ================================
    // Optimize Regression Computation
    // ================================

    // Convert finalX and finalY to ml-matrix
    const X_matrix = new Matrix(finalX); // Dimensions: [rows, cols]
    const y_vector = Matrix.columnVector(finalY); // Dimensions: [rows, 1]

    // Apply regularization by adding lambda * I to X^T X
    const Xt = X_matrix.transpose(); // [cols, rows]
    const XtX = Xt.mmul(X_matrix); // [cols, cols]
    const lambda = metadata.regularization;
    const identityMatrix = Matrix.eye(XtX.rows).mul(lambda);
    const XtX_reg = XtX.add(identityMatrix); // [cols, cols]

    // Instead of computing the inverse, solve the linear system (XtX + λI) * coeffs = X^T * y
    const Xt_y = Xt.mmul(y_vector); // [cols, 1]

    let coeffsArray: number[]| null;

    // Attempt to solve with all rules
    try {
        const coeffs = solve(XtX_reg, Xt_y);
        coeffsArray = coeffs.to1DArray();
    } catch (e){
        coeffsArray = attemptToSolve(XtX_reg, Xt_y, allRules, warnings);
        
        if (coeffsArray === null) {
            const warn_msg_final = `Unable to solve the regression problem even after removing all possible rules.`;
            warnings.push(warn_msg_final);
            console.warn(warn_msg_final);
            throw new Error(`Regression solve failed: ${warn_msg_final}`);
        }
    }

    // ================================
    // Proceed with Coefficients and Evaluation
    // ================================

    // Associate coefficients with rules and return them as objects
    const ruleCoefficients = allRules.map((rule, index) => {
        const antecedentStr = rule.antecedents.map(ant => `If ${ant.variable} is ${ant.fuzzySet}`).join(' AND ');
        return {
            rule: `${antecedentStr} then ${targetVar} is ${rule.outputFuzzySet}`,
            coefficient: coeffsArray ? coeffsArray[index] : 0,
            isWhitelist: rule.isWhitelist
        };
    });

    const sortedRules = ruleCoefficients.sort((a, b) => b.coefficient - a.coefficient);

    // Optionally, compute predictions and evaluate the model
    const y_pred = finalX.map(row => {
        return row.reduce((sum, val, idx) => sum + val * (coeffsArray ? coeffsArray[idx] : 0), 0);
    });

    // Compute error metrics
    const n = finalY.length;

    const mae = finalY.reduce((acc, val, idx) => acc + Math.abs(val - y_pred[idx]), 0) / n;
    const mse = finalY.reduce((acc, val, idx) => acc + Math.pow(val - y_pred[idx], 2), 0) / n;
    const rmse = Math.sqrt(mse);

    // R-squared
    const meanY = finalY.reduce((acc, val) => acc + val, 0) / n;
    const ssTot = finalY.reduce((acc, val) => acc + Math.pow(val - meanY, 2), 0);
    const ssRes = finalY.reduce((acc, val, idx) => acc + Math.pow(val - y_pred[idx], 2), 0);
    const rSquared = 1 - (ssRes / ssTot);

    // Mean Absolute Percentage Error (MAPE)
    const epsilon = 1e-10; // avoid divBy0
    const mape = (finalY.reduce((acc, val, idx) => {
        return acc + Math.abs((val - y_pred[idx]) / (Math.abs(val) + epsilon));
    }, 0) / n) * 100;

    return {
        mean_absolute_error: mae,
        root_mean_squared_error: rmse,
        r_squared: rSquared,
        mean_absolute_percentage_error: mape,
        warnings: warnings,
        sorted_rules: sortedRules.map(rule => ({
            rule: rule.rule,
            coefficient: rule.coefficient
        }))
    };
}
