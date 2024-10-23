import { Matrix, CholeskyDecomposition } from 'ml-matrix';
import { Rule } from '../types';
import { logWarning } from '../utils/logger';
import tCDF from '@stdlib/stats-base-dists-t-cdf';

/**
 * Retrieves top3 in linear runtime
 *
 * @param arr - The input array of numbers.
 * @returns An array containing the indices of the top three values.
 */
function getTopThreeIndices(arr: number[]): number[] {
    const topIndices: number[] = [];
    const topValues: number[] = [];

    for (let i = 0; i < arr.length; i++) {
        const value = arr[i];
        if (topIndices.length < 3) {
            topIndices.push(i);
            topValues.push(value);
            if (topIndices.length === 3) {
                // Sort the top three in descending order
                for (let j = 0; j < 2; j++) {
                    for (let k = j + 1; k < 3; k++) {
                        if (topValues[j] < topValues[k]) {
                            [topValues[j], topValues[k]] = [topValues[k], topValues[j]];
                            [topIndices[j], topIndices[k]] = [topIndices[k], topIndices[j]];
                        }
                    }
                }
            }
            continue;
        }

        if (value > topValues[2]) {
            topValues[2] = value;
            topIndices[2] = i;

            // Bubble up the new value to maintain order
            if (topValues[2] > topValues[1]) {
                [topValues[1], topValues[2]] = [topValues[2], topValues[1]];
                [topIndices[1], topIndices[2]] = [topIndices[2], topIndices[1]];
            }
            if (topValues[1] > topValues[0]) {
                [topValues[0], topValues[1]] = [topValues[1], topValues[0]];
                [topIndices[0], topIndices[1]] = [topIndices[1], topIndices[0]];
            }
        }
    }

    return topIndices;
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
): void {
    let activeIndices: number[] = allRules.map((_, index) => index);
    let attempts = 0;
    const maxAttempts = allRules.length;
    const lambda = metadata.regularization || 0;
    const dependencyThreshold = metadata.dependency_threshold;
    const significanceLevel = metadata.significance_level || 0.05;
    const removeInsignificantRules = metadata.remove_insignificant_rules || false;
    let coefficients: number[] | null = null;
    let pValues: number[] = [];
    const yVector = Matrix.columnVector(finalY);
    let removedLinearities = false;
    if(metadata.only_one_round_of_linearity_removal === undefined)
        metadata.only_one_round_of_linearity_removal = true;
    let removedByStatProperties = false;
    if(metadata.only_one_round_of_statistical_removal === undefined)
        metadata.only_one_round_of_statistical_removal = true;

    while (attempts < maxAttempts) {
        const subMatrixData: number[][] = finalX.map(row => activeIndices.map(col => row[col]));
        const XMatrix = new Matrix(subMatrixData);
        const Xt = XMatrix.transpose();
        const XtX = Xt.mmul(XMatrix);
        const identityMatrix = Matrix.eye(XtX.rows).mul(lambda);
        const XtXReg = XtX.clone().add(identityMatrix);

        let chol: CholeskyDecomposition | null = null;
        try {
            chol = new CholeskyDecomposition(XtXReg);
        } catch {
            // Cholesky decomposition failed
            chol = null;
        }

        if (chol) {
            // Check diagonal elements for dependency threshold
            const cholMatrix = chol.lowerTriangularMatrix;
            const diagElements = cholMatrix.diagonal();

            const problematicIndices: number[] = [];
            diagElements.forEach((value, index) => {
                if (Math.abs(value) < dependencyThreshold) {
                    problematicIndices.push(index);
                }
            });

            if (problematicIndices.length === 0 || removedLinearities) {
                // Successful decomposition and valid diagonals
                const XtY = Xt.mmul(yVector);
                const coeffs = chol.solve(XtY).to1DArray();
                coefficients = coeffs;

                // Compute residuals
                const predictedY = XMatrix.mmul(Matrix.columnVector(coefficients));
                const residuals = yVector.clone().sub(predictedY); //clone necessary because otherwise yVector is modified
                const residualSumOfSquares = residuals.transpose().mmul(residuals).get(0, 0);
                const degreesOfFreedom = finalX.length - activeIndices.length;
                logWarning(`Degrees of freedom: ${degreesOfFreedom}`, warnings);

                const sigmaSquared = residualSumOfSquares / degreesOfFreedom;

                // Compute covariance matrix
                const XtXInv = chol.solve(Matrix.eye(XtXReg.rows));
                const covarianceMatrix = XtXInv.mul(sigmaSquared);

                // Compute standard errors
                const standardErrors = covarianceMatrix.diagonal().map(Math.sqrt);

                // Compute t-statistics and p-values
                const tStatistics = coefficients.map((coef, idx) => coef / standardErrors[idx]);
                pValues = tStatistics.map(tStat =>
                    2 * (1 - tCDF(Math.abs(tStat), degreesOfFreedom))
                );

                // Identify insignificant variables
                const insignificantIndices: number[] = [];
                pValues.forEach((pValue, idx) => {
                    if (pValue > significanceLevel) {
                        insignificantIndices.push(idx);
                    }
                });

                if (removedByStatProperties || !removeInsignificantRules || insignificantIndices.length === 0) {
                    // All variables are significant; exit the loop
                    break;
                }

                // Collect rules to remove
                const rulesToRemove: number[] = insignificantIndices.map(idx => activeIndices[idx]);

                // Log warnings in batch
                const warnMessages = rulesToRemove.map(ruleIdx => {
                    const rule = allRules[ruleIdx];
                    return {
                        log: `Removed rule "${rule.toString(metadata.target_var)}" due to insignificance (p-value: ${pValues[activeIndices.indexOf(ruleIdx)].toFixed(4)}).`,
                    };
                });
                if (warnMessages.length > 0) {
                    logWarning(warnMessages, warnings); //TODO: fix in one batch
                }

                // Remove insignificant rules from activeIndices
                activeIndices = activeIndices.filter(idx => !rulesToRemove.includes(idx));
                attempts += rulesToRemove.length;
                removedByStatProperties = true && metadata.only_one_round_of_statistical_removal;
                continue; // Retry with the reduced set of rules
            }

            // Handle problematic indices due to linear dependencies
            const rulesToRemove: number[] = [];
            const warnMessages: any[] = [];

            problematicIndices.forEach(depIdx => {
                const ruleIdx = activeIndices[depIdx];
                const rule = allRules[ruleIdx];
                rulesToRemove.push(ruleIdx);

                // Get top three dependent rules
                const row = cholMatrix.getRow(depIdx);
                const top3Indices = getTopThreeIndices(row);
                const top3Rules = top3Indices.map(itemId => ({
                    rule: allRules[activeIndices[itemId]].toString(metadata.target_var),
                    coefficient: row[itemId]
                }));

                warnMessages.push({
                    log: `Removed rule "${rule.toString(metadata.target_var)}" due to linear dependence (small Cholesky diagonal value ${diagElements[depIdx].toExponential()}).`,
                    top3LinearDependentRules: top3Rules,
                });
            });

            if (rulesToRemove.length > 0) {
                // Remove problematic rules from activeIndices
                activeIndices = activeIndices.filter(idx => !rulesToRemove.includes(idx));
                attempts += rulesToRemove.length;
                logWarning(warnMessages, warnings);
                removedLinearities = true && metadata.only_one_round_of_linearity_removal;
                continue; // Retry with the reduced set of rules
            }
        } else {
            // Cholesky decomposition failed without a valid decomposition
            if (activeIndices.length === 0) {
                const finalWarn = `Unable to resolve linear dependencies with current threshold ${dependencyThreshold}.`;
                logWarning(finalWarn, warnings);
                throw new Error(`Regression solve failed: ${finalWarn}`);
            }

            // Remove the last rule
            const ruleIdx = activeIndices.pop()!;
            const rule = allRules[ruleIdx];
            const warnMsg = `Removed rule "${rule.toString(metadata.target_var)}" due to Cholesky decomposition failure.`;
            logWarning(warnMsg, warnings);
            attempts++;
            continue;
        }
    }

    if (attempts >= maxAttempts) {
        const finalWarn = `Unable to resolve linear dependencies after removing ${attempts} rules.`;
        logWarning(finalWarn, warnings);
        throw new Error(`Regression solve failed: ${finalWarn}`);
    }

    if (coefficients === null) {
        const finalWarn = `Regression coefficients could not be computed.`;
        logWarning(finalWarn, warnings);
        throw new Error(`Regression solve failed: ${finalWarn}`);
    }

    // Initialize all coefficients and p-values to zero and one respectively
    allRules.forEach(rule => {
        rule.coefficient = 0;
        rule.pValue = 1;
    });

    // Assign computed coefficients and p-values to the corresponding rules
    activeIndices.forEach((ruleIdx, idx) => {
        const rule = allRules[ruleIdx];
        rule.coefficient = coefficients![idx];
        rule.pValue = pValues[idx];
    });
}
