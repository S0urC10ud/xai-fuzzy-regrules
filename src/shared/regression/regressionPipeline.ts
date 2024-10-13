import { Matrix, CholeskyDecomposition, LuDecomposition } from 'ml-matrix';
import { Rule } from '../types';
import { attemptToSolve } from './solver';
import { logWarning } from '../utils/logger';
import tCDF from '@stdlib/stats-base-dists-t-cdf';

function getTopThreeIndices(arr: number[]) {
    const indexedArr = arr.map((value: any, index: number) => ({ value, index }));
    indexedArr.sort((a: any, b: any) => b.value - a.value);
    const topThree = indexedArr.slice(0, 3).map(item => item.index);
    return topThree;
}

/**
 * Performs regression with likelihood ratio test to decide if a rule is needed.
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
    let currentX = finalX.slice(); // Clone the design matrix
    allRules = allRules.map(rule => new Rule(rule.antecedents, rule.outputFuzzySet, rule.isWhitelist));
    let currentRules = allRules.slice(); // Clone the rules
    const lambda = metadata.regularization || 0; // Default to 0 if undefined
    const dependencyThreshold = metadata.dependency_threshold; // Threshold for diagonal absolute value
    const significanceLevel = metadata.significance_level || 0.05; // Default significance level

    let coefficients: number[] | null = null;
    let attempts = 0;
    const maxAttempts = allRules.length; // Prevent infinite loops

    while (attempts < maxAttempts) {
        const X_matrix = new Matrix(currentX); // Current design matrix
        const XtX = X_matrix.transpose().mmul(X_matrix);
        const identityMatrix = Matrix.eye(XtX.rows).mul(lambda);
        const XtX_reg = XtX.add(identityMatrix); // Regularized X^T X

        let chol: CholeskyDecomposition | null;
        try {
            chol = new CholeskyDecomposition(XtX_reg);
        } catch (error) {
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
                // Proceed to solve the regression
                const y_vector = Matrix.columnVector(finalY);
                const Xt_y = X_matrix.transpose().mmul(y_vector);

                // Solve for coefficients
                const coeffs = chol.solve(Xt_y).to1DArray();
                coefficients = coeffs;

                // Compute residuals
                const predictedY = X_matrix.mmul(Matrix.columnVector(coefficients));
                const residuals = y_vector.sub(predictedY);
                const residualSumOfSquares = residuals.transpose().mmul(residuals).get(0, 0);
                const degreesOfFreedom = currentX.length - currentX[0].length;
                const sigmaSquared = residualSumOfSquares / degreesOfFreedom;

                // Compute covariance matrix of coefficients
                const XtX_inv = chol.solve(Matrix.eye(XtX_reg.rows));
                const covarianceMatrix = XtX_inv.mul(sigmaSquared);

                // Compute standard errors
                const standardErrors = covarianceMatrix.diagonal().map(Math.sqrt);

                // Compute t-statistics and p-values
                const tStatistics = coefficients.map((coef, idx) => coef / standardErrors[idx]);
                const pValues = tStatistics.map(tStat =>
                    2 * (1 - tCDF(Math.abs(tStat), degreesOfFreedom))                
                );

                // Find indices of insignificant variables
                const insignificantIndices = pValues
                    .map((pValue, index) => ({ pValue, index }))
                    .filter(({ pValue }) => pValue > significanceLevel)
                    .map(({ index }) => index);

                if (insignificantIndices.length === 0) {
                    // All variables are significant; exit the loop
                    break;
                }

                // Remove insignificant variables
                // Iterate from highest index to avoid shifting issues
                insignificantIndices
                    .sort((a, b) => b - a)
                    .forEach(index => {
                        const ruleToRemove = currentRules[index];
                        if (ruleToRemove) {
                            currentRules.splice(index, 1); // Remove at index
                            currentX = currentX.map(row => {
                                const newRow = row.slice();
                                newRow.splice(index, 1);
                                return newRow;
                            });

                            const warnMsg = {
                                log: `Removed rule "${ruleToRemove.toString(
                                    metadata.target_var
                                )}" due to insignificance (p-value: ${pValues[index].toFixed(4)}).`,
                            };

                            logWarning(warnMsg, warnings);
                            attempts++;
                        }
                    });

                continue; // Retry with the reduced set of rules
            }

            // Remove rules corresponding to problematic indices
            // Iterate from highest index to avoid shifting issues
            problematicIndices
                .sort((a, b) => b - a)
                .forEach(index => {
                    const ruleToRemove = currentRules[index];
                    if (ruleToRemove) {
                        currentRules.splice(index, 1); // Remove at index
                        currentX = currentX.map(row => {
                            const newRow = row.slice();
                            newRow.splice(index, 1);
                            return newRow;
                        });

                        const warnMsg = {
                            log: `Removed rule "${ruleToRemove.toString(
                                metadata.target_var
                            )}" due to linear dependence (small Cholesky diagonal value ${diagElements[
                                index
                            ].toExponential()}).`,
                            top3LinearDependentRules: getTopThreeIndices(
                                cholMatrix.getRow(index)
                            ).map((item_id: number) => {
                                return {
                                    rule: allRules[item_id].toString(metadata.target_var),
                                    coefficient: cholMatrix.getRow(index)[item_id],
                                };
                            }),
                        };

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
            const warnMsg = `Removed rule "${ruleToRemove.toString(
                metadata.target_var
            )}" due to Cholesky decomposition failure.`;
            logWarning(warnMsg, warnings);
            attempts++;
            continue;
        }

        // If no rules left to remove, throw an error
        const finalWarn = `Unable to resolve linear dependencies with current threshold ${dependencyThreshold}.`;
        logWarning(finalWarn, warnings);
        throw new Error(`Regression solve failed: ${finalWarn}`);
    }

    if (attempts === maxAttempts) {
        const finalWarn = `Unable to resolve linear dependencies after removing ${attempts} rules.`;
        logWarning(finalWarn, warnings);
        throw new Error(`Regression solve failed: ${finalWarn}`);
    }

    // Map coefficients back to the original rule set with zeros for removed rules
    const fullCoefficients = allRules.map(rule => {
        const index = currentRules.findIndex(r => r === rule);
        return index !== -1 ? coefficients![index] : 0;
    });

    return fullCoefficients;
}
