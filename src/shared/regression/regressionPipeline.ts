import { Matrix, CholeskyDecomposition, LuDecomposition } from 'ml-matrix';
import { Rule } from '../types';
import { attemptToSolve } from './solver';
import { logWarning } from '../utils/logger';

/**
 * Performs regression with linear dependency handling using Cholesky and LU decomposition.
 *
 * @param finalX - The design matrix with samples as rows and rules as columns.
 * @param finalY - The target vector.
 * @param allRules - Array of all possible rules.
 * @param metadata - Metadata containing regression parameters like regularization.
 * @param warnings - Array to collect warnings during the process.
 * @returns The regression coefficients array.
 */
export function performRegression(
    finalX: number[][],
    finalY: number[],
    allRules: Rule[],
    metadata: any,
    warnings: any[]
): number[] {
    // Initialize variables
    let currentX = finalX.slice(); // Clone the design matrix
    let currentRules = allRules.slice(); // Clone the rules
    const lambda = metadata.regularization || 0; // Default to 0 if undefined
    const dependencyThreshold = 1; // Threshold for diagonal absolute value

    let coefficients: number[] | null = null;
    let attempts = 0;
    const maxAttempts = allRules.length; // Prevent infinite loops

    while (attempts < maxAttempts) {
        const X_matrix = new Matrix(currentX); // Current design matrix
        const XtX = X_matrix.transpose().mmul(X_matrix);
        const identityMatrix = Matrix.eye(XtX.rows).mul(lambda);
        const XtX_reg = XtX.add(identityMatrix); // Regularized X^T X

        let chol: CholeskyDecomposition | null = null;
        try {
            chol = new CholeskyDecomposition(XtX_reg);
        } catch (error) {
            // Cholesky failed, possibly due to dependencies
            chol = null;
        }

        if (chol) {
            // Validate the diagonal elements
            const cholMatrix = chol.lowerTriangularMatrix;
            const diagElements = cholMatrix.diagonal();

            // Find indices where the absolute diagonal value is less than the threshold
            const problematicIndices = diagElements
                .map((value, index) => ({ value, index }))
                .filter(({ value }) => Math.abs(value) < dependencyThreshold)
                .map(({ index }) => index);

            if (problematicIndices.length === 0) {
                // Decomposition is successful and all diagonals are valid
                break;
            }

            // Remove rules corresponding to problematic indices
            // Iterate from highest index to avoid shifting issues
            problematicIndices.sort((a, b) => b - a).forEach(index => {
                const ruleToRemove = currentRules[index];
                if (ruleToRemove) {
                    currentRules.splice(index, 1); //remove at index
                    currentX = currentX.map(row => {
                        const newRow = row.slice();
                        newRow.splice(index, 1);
                        return newRow;
                    });

                    const warnMsg = `Removed rule "${ruleToRemove.toString()}" due to small diagonal value (${diagElements[index].toExponential()}).`;
                    logWarning(warnMsg, warnings);
                    attempts++;
                }
            });

            continue; // Retry with the reduced set of rules
        }

        // If Cholesky decomposition failed without a valid decomposition
        // Remove the last rule and retry
        const ruleToRemove = currentRules.pop();
        if (ruleToRemove) {
            currentX = currentX.map(row => row.slice(0, -1));
            const warnMsg = `Removed rule "${ruleToRemove.toString()}" due to Cholesky decomposition failure.`;
            logWarning(warnMsg, warnings);
            attempts++;
            continue;
        }

        // If no rules left to remove, throw an error
        const finalWarn = `Unable to resolve linear dependencies with current threshold (${dependencyThreshold}).`;
        logWarning(finalWarn, warnings);
        throw new Error(`Regression solve failed: ${finalWarn}`);
    }

    if (attempts === maxAttempts) {
        const finalWarn = `Unable to resolve linear dependencies after removing ${attempts} rules.`;
        logWarning(finalWarn, warnings);
        throw new Error(`Regression solve failed: ${finalWarn}`);
    }

    // Proceed to solve the regression
    const XtX_final = currentX.length > 0
        ? new Matrix(currentX).transpose().mmul(new Matrix(currentX)).add(Matrix.eye(currentX[0].length).mul(lambda))
        : new Matrix([]);
    const y_final = Matrix.columnVector(finalY);

    const Xt_y_final = new Matrix(currentX).transpose().mmul(y_final);

    try {
        // Use LU Decomposition to solve
        const lu = new LuDecomposition(XtX_final);
        const coeffs = lu.solve(Xt_y_final).to1DArray();
        coefficients = coeffs;
    } catch (error) {
        // If LU solve fails, attempt to solve with the existing mechanism
        coefficients = attemptToSolve(XtX_final, Xt_y_final, currentRules, metadata, warnings);
        if (coefficients === null) {
            const finalWarn = `Unable to solve the regression problem even after resolving dependencies.`;
            logWarning(finalWarn, warnings);
            throw new Error(`Regression solve failed: ${finalWarn}`);
        }
    }

    // Map coefficients back to the original rule set with zeros for removed rules
    const fullCoefficients = allRules.map(rule => {
        const index = currentRules.findIndex(r => r === rule);
        return index !== -1 ? coefficients![index] : 0;
    });

    return fullCoefficients;
}
