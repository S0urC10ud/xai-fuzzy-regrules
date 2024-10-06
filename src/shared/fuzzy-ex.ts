import * as csv from 'csv-parse/sync';
import * as math from 'mathjs';
import { generateFuzzificationChart } from './utils/fuzzification';
import { Matrix } from 'mathjs';
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
};

type Record = { [key: string]: string | number };

// Updated Rule type to include new output fuzzy sets
type Rule = {
    variable: string;
    fuzzySet: 'verylow' | 'low' | 'mediumlow' | 'medium' | 'mediumhigh' | 'high' | 'veryhigh';
    outputFuzzySet: 'verylow' | 'low' | 'mediumlow' | 'medium' | 'mediumhigh' | 'high' | 'veryhigh';
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
        // Check if any degree in the output fuzzy set is greater than zero, done later
    });

    // Generate rules
    let rules: (Rule | null)[] = [];
    numericalKeys.filter(key => key !== targetVar).forEach(key => {
        metadata["numerical_fuzzification"].forEach(fuzzySet => {
            outputFuzzySetsList.forEach(outputSet => {
                if (fuzzySet !== outputSet) { // Adjust this condition as needed

                    // Before adding the rule, check if both antecedent and consequent fuzzy sets are non-empty
                    if (inputFuzzySetNonEmpty[key][fuzzySet] && outputFuzzySetNonEmpty[outputSet]) {
                        const rule: Rule = {
                            variable: key,
                            fuzzySet: fuzzySet as 'verylow' | 'low' | 'mediumlow' | 'medium' | 'mediumhigh' | 'high' | 'veryhigh',
                            outputFuzzySet: outputSet as 'verylow' | 'low' | 'mediumlow' | 'medium' | 'mediumhigh' | 'high' | 'veryhigh',
                        };
                        rules.push(rule);
                    }
                }
            });
        });
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

    // Re-generate rules with the updated outputFuzzySetNonEmpty
    rules = []; // Reset rules
    numericalKeys.filter(key => key !== targetVar).forEach(key => {
        metadata["numerical_fuzzification"].forEach(fuzzySet => {
            ['low', 'medium', 'high'].forEach(fuzzySetVariant => { // Adjusted fuzzy sets as per original code
                outputFuzzySetsList.forEach(outputSet => {
                    if (fuzzySet !== outputSet) { // Adjust this condition as needed

                        // Check if both antecedent and consequent fuzzy sets are non-empty
                        if (inputFuzzySetNonEmpty[key][fuzzySet] && outputFuzzySetNonEmpty[outputSet]) {
                            const rule: Rule = {
                                variable: key,
                                fuzzySet: fuzzySet as 'verylow' | 'low' | 'mediumlow' | 'medium' | 'mediumhigh' | 'high' | 'veryhigh',
                                outputFuzzySet: outputSet as 'verylow' | 'low' | 'mediumlow' | 'medium' | 'mediumhigh' | 'high' | 'veryhigh',
                            };
                            rules.push(rule);
                        }
                    }
                });
            });
        });
    });

    // Initialize feature matrix X and target vector y
    const X: number[][] = []; // Each row corresponds to a record (and contains all rules), each column corresponds to a rule's crisp output
    const y: number[] = recordsAfterFiltering.map((record) => parseFloat(record[targetVar] as string));

    // For each record, compute the crisp output for each rule
    recordsAfterFiltering.forEach((record, index) => {
        const featureVector: number[] = [];

        rules.forEach(rule => {
            if (rule == null)
                return;
            const firingStrength = record[`${rule.variable}_${rule.fuzzySet}`] as number;

            // Get the output fuzzy set's membership degrees over the output universe
            const outputFuzzySetDegrees = outputFuzzySets[rule.outputFuzzySet];

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
    // Updated Duplicate Row Removal
    // ================================

    // Function to compute L1 norm between two rows
    const computeL1Norm = (row1: number[], row2: number[]): number => {
        if (row1.length !== row2.length) {
            throw new Error('Rows must have the same length to compute L1 norm.');
        }
        let sum = 0;
        for (let i = 0; i < row1.length; i++) {
            sum += Math.abs(row1[i] - row2[i]);
        }
        return sum;
    };

    const uniqueX: number[][] = [];
    const uniqueY: number[] = [];
    let duplicateRowCount = 0;
    const rowThreshold = metadata["l1_row_threshold"]; // L1 norm threshold

    for (let i = 0; i < X.length; i++) {
        const currentRow = X[i];
        let isDuplicate = false;

        for (const uniqueRow of uniqueX) {
            const l1Norm = computeL1Norm(currentRow, uniqueRow);
            if (l1Norm < rowThreshold) {
                isDuplicate = true;
                duplicateRowCount++;
                break;
            }
        }

        if (!isDuplicate) {
            uniqueX.push(currentRow);
            uniqueY.push(y[i]);
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
    // Updated Duplicate Column Removal
    // ================================

    // Function to compute L1 norm between two columns
    const computeColumnL1Norm = (col1: number[], col2: number[]): number => {
        if (col1.length !== col2.length) {
            throw new Error('Columns must have the same length to compute L1 norm.');
        }
        let sum = 0;
        for (let i = 0; i < col1.length; i++) {
            sum += Math.abs(col1[i] - col2[i]);
        }
        return sum;
    };

    const duplicateColumnGroups: number[][] = [];
    const keptColumns: number[] = [];
    const columnL1Threshold = metadata["l1_column_threshold"];
    for (let col = 0; col < finalX[0].length; col++) {
        let isDuplicate = false;
        for (const keptCol of keptColumns) {
            const col1 = finalX.map(row => row[col]);
            const col2 = finalX.map(row => row[keptCol]);
            const l1Norm = computeColumnL1Norm(col1, col2);
            if (l1Norm < columnL1Threshold) {
                // Find the group that the keptCol belongs to
                let groupFound = false;
                for (const group of duplicateColumnGroups) {
                    if (group.includes(keptCol)) {
                        group.push(col);
                        groupFound = true;
                        break;
                    }
                }
                if (!groupFound) {
                    duplicateColumnGroups.push([keptCol, col]);
                }
                isDuplicate = true;
                break;
            }
        }

        if (!isDuplicate) {
            keptColumns.push(col);
        }
    }

    if (duplicateColumnGroups.length > 0) {
        // Collect details for warnings
        const duplicateDetails = duplicateColumnGroups
            .filter(group => group.length > 1)
            .map(group => {
                const [primary, ...duplicates] = group;
                const primaryRule = rules[primary];
                if (!primaryRule) return '';
                const duplicateRules = duplicates.map(colIndex => {
                    const rule = rules[colIndex];
                    if (rule == null) return '';
                    const ret_text = `If ${rule.variable} is ${rule.fuzzySet} then ${targetVar} is ${rule.outputFuzzySet}`;
                    rules[colIndex] = null;
                    return ret_text;
                }).filter(Boolean).join(' | ');
                return `Primary Rule: If ${primaryRule.variable} is ${primaryRule.fuzzySet} then ${targetVar} is ${primaryRule.outputFuzzySet}\nDuplicate Rules: ${duplicateRules}`;
            })
            .filter(detail => detail !== '')
            .join('\n\n');

        const warn_msg = `Duplicate columns detected based on L1-Norm < ${columnL1Threshold}:\n${duplicateDetails}`;
        warnings.push(warn_msg);
        console.warn(warn_msg);

        // Remove marked null rules and corresponding columns
        const keptColumnsSet = new Set(keptColumns);
        const uniqueXUpdated = finalX.map(row => {
            return row.filter((_, colIndex) => keptColumnsSet.has(colIndex));
        });
        const filteredRules = rules.filter(rule => rule !== null) as Rule[];

        // Replace finalX and rules with filtered versions
        finalX.length = 0;
        finalX.push(...uniqueXUpdated);
        rules = filteredRules;
    }

    // Proceed with finalX and finalY
    const X_matrix = math.matrix(finalX);
    const y_vector = math.matrix(finalY);

    // Compute Xt and XtX
    const Xt = math.transpose(X_matrix);
    const XtX = math.multiply(Xt, X_matrix);

    const lambda = metadata["regularization"]; // Small regularization parameter
    const identityMatrix = math.identity(XtX.size()[0]);
    const XtX_reg = math.add(XtX, math.multiply(identityMatrix, lambda)) as Matrix;

    // Convert to a numeric matrix
    const XtX_reg_numeric = (XtX_reg as Matrix).toArray() as number[][];

    // ================================
    // SVD-Based Pseudo-Inversion
    // ================================

    // Compute the Moore-Penrose pseudo-inverse using SVD via mathjs's pinv
    const XtX_pinv = math.pinv(XtX_reg_numeric) as number[][];

    // Multiply Xt_pinv with y_vector
    const Xt_y = math.multiply(Xt, y_vector) as Matrix;
    const Xt_y_array = Xt_y.toArray() as number[];

    // Compute coefficients using the pseudo-inverse
    const coeffs = math.multiply(XtX_pinv, Xt_y_array) as number[];

    // ================================

    const coeffsArray = coeffs as number[];

    // Associate coefficients with rules and return them as objects
    const ruleCoefficients = rules.map((rule, index) => {
        if (rule == null)
            return {
                rule: "deleted - you should not see this here",
                coefficient: 0
            };
        return {
            rule: `If ${rule.variable} is ${rule.fuzzySet} then ${targetVar} is ${rule.outputFuzzySet}`,
            coefficient: coeffsArray[index],
        };
    });

    const sortedRules = ruleCoefficients.sort((a, b) => b.coefficient - a.coefficient);

    // Optionally, compute predictions and evaluate the model
    const y_pred = finalX.map(row => {
        return row.reduce((sum, val, idx) => sum + val * coeffsArray[idx], 0);
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
    const mape = finalY.reduce((acc, val, idx) => {
        return acc + Math.abs((val - y_pred[idx]) / (Math.abs(val) + epsilon));
    }, 0) / n * 100;

    return {
        sorted_rules: sortedRules,
        mean_absolute_error: mae,
        root_mean_squared_error: rmse,
        r_squared: rSquared,
        mean_absolute_percentage_error: mape,
        warnings: warnings
    };
}
