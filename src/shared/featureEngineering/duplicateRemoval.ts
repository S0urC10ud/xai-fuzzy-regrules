import { Rule, Record } from '../types';
import { hashRow, hashColumn } from '../utils/hashUtils';
import { logWarning } from '../utils/logger';

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

export function removeDuplicateColumns(
    X: number[][],
    allRules: Rule[],
    columnThreshold: number,
    targetVar: string,
    warnings: string[]
): { finalX: number[][]; filteredRules: Rule[] } {
    const keptColumns: number[] = [];
    const columnHashes = new Map<string, number>();
    const duplicateColumnGroups: number[][] = [];

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

    const duplicateColumnCount = X[0].length - keptColumns.length;

    if (duplicateColumnCount > 0) {
        const duplicateDetails = duplicateColumnGroups
            .filter(group => group.length > 1)
            .map(group => {
                const [primary, ...duplicates] = group;
                const primaryRule = allRules[primary];
                if (!primaryRule) return '';
                const duplicateRules = duplicates.map(colIndex => {
                    const rule = allRules[colIndex];
                    if (!rule) return '';
                    const antecedentStr = rule.antecedents.map(ant => `If ${ant.variable} is ${ant.fuzzySet}`).join(' AND ');
                    return `${antecedentStr} then ${targetVar} is ${rule.outputFuzzySet}`;
                }).filter(Boolean).join(' | ');
                const primaryAntecedentStr = primaryRule.antecedents.map(ant => `If ${ant.variable} is ${ant.fuzzySet}`).join(' AND ');
                return `Primary Rule: ${primaryAntecedentStr} then ${targetVar} is ${primaryRule.outputFuzzySet}\nDuplicate Rules: ${duplicateRules}`;
            })
            .filter(detail => detail !== '')
            .join('\n\n');

        logWarning(
            `Duplicate columns detected and removed based on L1-Norm < ${columnThreshold}:\n${duplicateDetails}`,
            warnings
        );

        const uniqueXUpdated = X.map(row => keptColumns.map(colIndex => row[colIndex]));
        const filteredRules = keptColumns.map(colIndex => allRules[colIndex]).filter(rule => rule !== null) as Rule[];

        return { finalX: uniqueXUpdated, filteredRules };
    }

    return { finalX: X, filteredRules: allRules };
}
