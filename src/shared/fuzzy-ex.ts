import * as csv from 'csv-parse/sync';
import * as math from 'mathjs';
import { computeQuantiles } from './utils/quantiles';
import { computeMembershipDegrees } from './utils/fuzzy';
import { generateFuzzificationChart } from './utils/fuzzification';
import { Matrix } from 'mathjs';

type Metadata = {
    target_var: string;
    split_char: string;
    use_regularization: boolean;
};

type Record = { [key: string]: string | number };

type Rule = {
    variable: string;
    fuzzySet: 'low' | 'medium' | 'high';
    outputFuzzySet: 'low' | 'medium' | 'high'; // Since output fuzzy set corresponds to input fuzzy set
};

export function main(metadata: Metadata, data: string): { sorted_rules: { rule: string, coefficient: number }[]; mean_squared_error: number; warnings: string[] } {
    const targetVar = metadata["target_var"];
    const warnings: string[] = [];
    const records: Record[] = csv.parse(data, {
        columns: true,
        delimiter: metadata["split_char"],
        skip_empty_lines: true,
    });

    // Make a copy of the target variable before fuzzification
    const originalTargetValues: number[] = records.map((record) => parseFloat(record[targetVar] as string));

    // Identify numerical and categorical keys
    const numericalKeys: string[] = Object.keys(records[0]).filter(key => {
        return records.every(record => !isNaN(parseFloat(record[key] as string)));
    });

    const categoricalKeys: string[] = Object.keys(records[0]).filter(key => !numericalKeys.includes(key));

    // Store quantiles for numerical variables
    const variableQuantiles: { [key: string]: { min: number, q1: number, q2: number, max: number } } = {};

    // Process numerical columns (including target variable)
    numericalKeys.forEach(key => {
        const values: number[] = records.map(record => parseFloat(record[key] as string));
        const sortedValues = [...values].sort((a, b) => a - b);
        const min = sortedValues[0];
        const max = sortedValues[sortedValues.length - 1];
        const quantiles = computeQuantiles(sortedValues, [0.33, 0.66]);
        const q1 = quantiles[0];
        const q2 = quantiles[1];

        variableQuantiles[key] = { min, q1, q2, max };

        if (key !== targetVar) {
            generateFuzzificationChart(values, min, q1, q2, max, key);

            records.forEach(record => {
                const x = parseFloat(record[key] as string);
                const degrees = computeMembershipDegrees(x, min, q1, q2, max);
                record[`${key}_low`] = parseFloat(degrees.low.toFixed(4));
                record[`${key}_medium`] = parseFloat(degrees.medium.toFixed(4));
                record[`${key}_high`] = parseFloat(degrees.high.toFixed(4));
                delete record[key];
            });
        }
    });

    categoricalKeys.forEach(key => {
        const uniqueCategories: string[] = [...new Set(records.map(record => record[key] as string))];

        uniqueCategories.forEach(category => {
            records.forEach(record => {
                record[`${key}_${category}`] = record[key] === category ? 1 : 0;
            });
        });

        records.forEach(record => {
            delete record[key];
        });
    });

    // Generate rules
    let rules: (Rule|null)[] = [];
    numericalKeys.filter(key => key !== targetVar).forEach(key => {
        ['low', 'medium', 'high'].forEach(fuzzySet => {
            ['low', 'medium', 'high'].forEach(outputSet => {
                if (fuzzySet !== outputSet) {
                    const rule = {
                        variable: key,
                        fuzzySet: fuzzySet as 'low' | 'medium' | 'high',
                        outputFuzzySet: outputSet as 'low' | 'medium' | 'high',
                    };

                    rules.push(rule);
                }
            });
        });
    });

    // Prepare the output fuzzy sets for the target variable
    const targetQuantiles = variableQuantiles[targetVar];
    const targetMin = targetQuantiles.min;
    const targetQ1 = targetQuantiles.q1;
    const targetQ2 = targetQuantiles.q2;
    const targetMax = targetQuantiles.max;

    const outputUniverse: number[] = [];
    const numOutputPoints = 100;
    const outputStep = (targetMax - targetMin) / (numOutputPoints - 1);

    for (let i = 0; i < numOutputPoints; i++) {
        const value = targetMin + i * outputStep;
        outputUniverse.push(value);
    }

    const outputFuzzySets = {
        low: [] as number[],
        medium: [] as number[],
        high: [] as number[],
    };

    outputUniverse.forEach(value => {
        const degrees = computeMembershipDegrees(value, targetMin, targetQ1, targetQ2, targetMax);
        outputFuzzySets.low.push(degrees.low);
        outputFuzzySets.medium.push(degrees.medium);
        outputFuzzySets.high.push(degrees.high);
    });

    // Initialize feature matrix X and target vector y
    const X: number[][] = []; // Each row corresponds to a record (and contains all rules), each column corresponds to a rule's crisp output
    const y: number[] = originalTargetValues;

    // For each record, compute the crisp output for each rule
    records.forEach((record, index) => {
        const featureVector: number[] = [];

        rules.forEach(rule => {
            if(rule == null)
                return
            const firingStrength = record[`${rule.variable}_${rule.fuzzySet}`] as number;

            // Get the output fuzzy set's membership degrees over the output universe
            const outputFuzzySetDegrees = outputFuzzySets[rule.outputFuzzySet];

            // Vertically cap
            const ruleOutputMembershipDegrees = outputFuzzySetDegrees.map(degree => Math.min(firingStrength, degree));

            // Defuzzify the rule's output fuzzy set using Middle of Maximum (MoM)
            const maxMembershipDegree = Math.max(...ruleOutputMembershipDegrees);

            // Find all indices where the membership degree equals the maximum
            const indicesAtMax = [];
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

    // Eliminate Duplicate Samples/Rows

    // Function to serialize a row for comparison
    const serializeRow = (row: number[]): string => row.join(',');

    const uniqueRowSet = new Set<string>();
    const uniqueX: number[][] = [];
    const uniqueY: number[] = [];
    let duplicateRowCount = 0;

    for (let i = 0; i < X.length; i++) {
        const rowKey = serializeRow(X[i]);
        if (!uniqueRowSet.has(rowKey)) {
            uniqueRowSet.add(rowKey);
            uniqueX.push(X[i]);
            uniqueY.push(y[i]);
        } else {
            duplicateRowCount++;
        }
    }

    if (duplicateRowCount > 0) {
        warnings.push(`Duplicate rows detected and removed: ${duplicateRowCount}`);
    }
    const finalX = uniqueX;
    const finalY = uniqueY;

    // Eliminate Duplicate Columns

    // Function to serialize a column for comparison
    const serializeColumn = (columnIndex: number): string => {
        return finalX.map(row => row[columnIndex]).join(',');
    };

    const columnMap = new Map<string, number[]>();
    const duplicateColumns: { [key: string]: number[] } = {};

    for (let col = 0; col < finalX[0].length; col++) {
        const colKey = serializeColumn(col);
        if (columnMap.has(colKey)) {
            const existingCols = columnMap.get(colKey)!;
            existingCols.push(col);
            duplicateColumns[`Rule ${col}`] = existingCols;
        } else {
            columnMap.set(colKey, [col]);
        }
    }

    // Collect all duplicate column groups
    const duplicateColumnGroups: number[][] = [];
    columnMap.forEach((cols, key) => {
        if (cols.length > 1) {
            duplicateColumnGroups.push(cols);
        }
    });

    if (duplicateColumnGroups.length > 0) {
        const duplicateDetails = duplicateColumnGroups.map(group => {
            const ruleNames = group.map(colIndex => {
                const rule = rules[colIndex];
                if(rule == null)
                    return
                return `If ${rule.variable} is ${rule.fuzzySet} then ${targetVar} is ${rule.outputFuzzySet}`;
            });
            return ruleNames.join(' | ');
        }).join('\n');

        // Add the warning about duplicate columns detected
        warnings.push(`Duplicate columns detected:\n${duplicateDetails}`);

        // Remove duplicate columns from finalX and their corresponding rules
        const columnsToKeep = new Set<number>(finalX[0].map((_, colIndex) => colIndex)); // Initially keep all columns
        duplicateColumnGroups.forEach(group => {
            // Keep only the first column in each group and remove corresponding rules
            for (let i = 1; i < group.length; i++) {
                columnsToKeep.delete(group[i]);
                rules[group[i]] = null; // Mark rule for deletion
            }
        });

        // Remove marked null rules
        rules = rules.filter(rule => rule !== null);

        // Rebuild finalX by keeping only unique columns
        const uniqueX = finalX.map(row => Array.from(columnsToKeep).map(colIndex => row[colIndex]));
        finalX.length = 0;
        finalX.push(...uniqueX); // Replace finalX with unique columns
    }

    // Proceed with finalX and finalY
    const X_matrix = math.matrix(finalX);
    const y_vector = math.matrix(finalY);

    // Compute Xt and XtX
    const Xt = math.transpose(X_matrix);
    const XtX = math.multiply(Xt, X_matrix);
    let XtX_reg;

    if(metadata["use_regularization"]) {
        const lambda = 1e-5; // Small regularization parameter
        const identityMatrix = math.identity(XtX.size()[0]);
        XtX_reg = math.add(XtX, math.multiply(identityMatrix, lambda)) as Matrix;
    } else {
        XtX_reg = XtX;
    }

    // Check if XtX_reg is invertible by checking its determinant
    const determinant = math.det(XtX_reg);
    if (determinant === 0) {
        console.error('The matrix X^T X is singular (determinant is 0).');
        throw new Error('Cannot invert X^T X because it is singular.');
    }

    // Convert to a numeric matrix
    const XtX_reg_numeric = (XtX_reg as Matrix).toArray() as number[][];

    const XtX_inv = math.inv(XtX_reg_numeric);
    const Xt_y = math.multiply(Xt, y_vector);
    const coeffs = math.multiply(XtX_inv, Xt_y);

    const coeffsArray = coeffs.valueOf() as number[];

    // Associate coefficients with rules and return them as objects
    const ruleCoefficients = rules.map((rule, index) => {
        if(rule == null)
            return {
                rule: "deleted - you should not see this here",
                coefficient: 0
            }
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

    // Compute error metrics, y_pred vs finalY
    const mse = finalY.reduce((acc, val, idx) => acc + Math.pow(val - y_pred[idx], 2), 0) / finalY.length;

    return {
        "sorted_rules": sortedRules,
        "mean_squared_error": mse,
        "warnings": warnings
    };
}
