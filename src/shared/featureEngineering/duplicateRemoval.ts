import { Rule, Record } from '../types';
import { hashRow, hashColumn } from '../utils/hashUtils';
import { logWarning } from '../utils/logger';

interface DuplicateDetail {
    primary: string;
    secondary: string[];
}

/**
 * Removes duplicate rows from the dataset based on the L1-Norm threshold.
 * @param X - The feature matrix.
 * @param y - The target vector.
 * @param rowThreshold - The L1-Norm threshold for determining duplicates.
 * @param warnings - An array to store warning messages.
 * @returns An object containing the filtered feature matrix and target vector.
 */
export function removeDuplicateRows(
    X: number[][],
    y: number[],
    rowThreshold: number,
    warnings: string[]
): { finalX: number[][]; finalY: number[] } {
    const uniqueX: number[][] = [];
    const uniqueY: number[] = [];
    const rowHashes = new Map<string, number>();
    let duplicateRowCount = 0;

    for (let i = 0; i < X.length; i++) {
        const currentRow = X[i];
        const currentHash = hashRow(currentRow, rowThreshold);

        if (!rowHashes.has(currentHash)) {
            rowHashes.set(currentHash, uniqueX.length);
            uniqueX.push(currentRow);
            uniqueY.push(y[i]);
        } else {
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
        logWarning(
            `Duplicate rows detected and removed based on L1-Norm < ${rowThreshold}: ${duplicateRowCount}`,
            warnings
        );
    }

    return { finalX: uniqueX, finalY: uniqueY };
}

/**
 * Removes duplicate columns from the dataset based on the L1-Norm threshold and updates the rules accordingly.
 * @param X - The feature matrix.
 * @param allRules - An array of rules corresponding to each column.
 * @param columnThreshold - The L1-Norm threshold for determining duplicates.
 * @param targetVar - The target variable name.
 * @param warnings - An array to store warning messages.
 * @returns An object containing the filtered feature matrix and filtered rules.
 */
export function removeDuplicateColumns(
    X: number[][],
    allRules: Rule[],
    columnThreshold: number,
    targetVar: string,
    warnings: DuplicateDetail[] // Changed from string[] to DuplicateDetail[]
): { finalX: number[][]; filteredRules: Rule[] } {
    const keptColumns: number[] = [];
    const columnHashes = new Map<string, number>();
    const duplicateColumnGroups: DuplicateDetail[] = [];

    for (let col = 0; col < X[0].length; col++) {
        const currentColumn = X.map(row => row[col]);
        const currentHash = hashColumn(currentColumn, columnThreshold);

        if (!columnHashes.has(currentHash)) {
            columnHashes.set(currentHash, keptColumns.length);
            keptColumns.push(col);
        } else {
            const existingIndex = columnHashes.get(currentHash)!;
            const existingColumn = X.map(row => row[keptColumns[existingIndex]]);
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
                const primaryRule = allRules[keptColumns[existingIndex]];
                const duplicateRule = allRules[col];
                if (primaryRule && duplicateRule) {
                    const primaryAntecedents = primaryRule.antecedents
                        .map(ant => `If ${ant.variable} is ${ant.fuzzySet}`)
                        .join(' AND ');
                    const duplicateAntecedents = duplicateRule.antecedents
                        .map(ant => `If ${ant.variable} is ${ant.fuzzySet}`)
                        .join(' AND ');

                    const primaryRuleStr = `${primaryAntecedents} then ${targetVar} is ${primaryRule.outputFuzzySet}`;
                    const duplicateRuleStr = `${duplicateAntecedents} then ${targetVar} is ${duplicateRule.outputFuzzySet}`;

                    // Check if a group for this primary already exists
                    const existingGroup = duplicateColumnGroups.find(
                        group => group.primary === primaryRuleStr
                    );

                    if (existingGroup) {
                        existingGroup.secondary.push(duplicateRuleStr);
                    } else {
                        duplicateColumnGroups.push({
                            primary: primaryRuleStr,
                            secondary: [duplicateRuleStr],
                        });
                    }
                }
            } else {
                columnHashes.set(currentHash, keptColumns.length);
                keptColumns.push(col);
            }
        }
    }

    const duplicateColumnCount = X[0].length - keptColumns.length;

    if (duplicateColumnCount > 0) {
        if (duplicateColumnGroups.length > 0) {
            logWarning(
                duplicateColumnGroups,
                warnings
            );
        } else {
            // Fallback warning if no detailed groups are found
            logWarning(
                `Duplicate columns detected and removed based on L1-Norm < ${columnThreshold}: ${duplicateColumnCount}`,
                warnings
            );
        }

        const uniqueXUpdated = X.map(row => keptColumns.map(colIndex => row[colIndex]));
        const filteredRules = keptColumns.map(colIndex => allRules[colIndex]).filter(rule => rule !== null) as Rule[];

        return { finalX: uniqueXUpdated, filteredRules };
    }

    return { finalX: X, filteredRules: allRules };
}
