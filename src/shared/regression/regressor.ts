import { Matrix, QrDecomposition, inverse } from 'ml-matrix';
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
    let lambda = metadata.regularization || 0;
    const dependencyThreshold = metadata.dependency_threshold;
    const significanceLevel = metadata.significance_level || 0.05;
    const removeInsignificantRules = metadata.remove_insignificant_rules || false;
    let coefficients: number[] | null = null;
    let pValues: number[] = [];
    const yVector = Matrix.columnVector(finalY);
    let removedLinearities = false;
    if (metadata.only_one_round_of_linearity_removal === undefined)
        metadata.only_one_round_of_linearity_removal = true;
    let removedByStatProperties = false;
    if (metadata.only_one_round_of_statistical_removal === undefined)
        metadata.only_one_round_of_statistical_removal = true;

    const warnCollector: any[] = [];
    while (attempts < maxAttempts) {
        const subMatrixData: number[][] = finalX.map(row => activeIndices.map(col => row[col]));
        const XMatrix = new Matrix(subMatrixData);
        //TODO: think about regularization
        const p = activeIndices.length;
        let qr = new QrDecomposition(XMatrix);

        if (qr) {
            // Check diagonal elements of R for dependency
            const R = qr.upperTriangularMatrix;
            const diagElements = R.diagonal();

            const problematicIndices: number[] = [];
            diagElements.forEach((value:any, index:number) => {
                if (value == null || isNaN(value))
                    throw new Error("QR decomposition failed, consider increasing the regularization - diagonal value is null or NaN");

                if (Math.abs(value) < dependencyThreshold) {
                    if (metadata.include_intercept !== false && index === 0) {
                        // Skip the intercept column
                        return;
                    }
                    problematicIndices.push(index);
                }
            });

            if (problematicIndices.length === 0 || removedLinearities) {
                // Successful decomposition and valid diagonals
                let beta: number[];
                try {
                    const betaMatrix = qr.solve(yVector);
                    beta = betaMatrix.to1DArray().slice(0, p); // Extracting coefficients
                } catch (error) {
                    const finalWarn = `QR solve failed, possibly due to numerical issues.`;
                    logWarning(finalWarn, warnings);
                    throw new Error(`Regression solve failed: ${finalWarn}`);
                }

                coefficients = beta;

                // Compute residuals
                const predictedY = XMatrix.mmul(Matrix.columnVector(coefficients));
                const residuals = yVector.clone().sub(predictedY); //clone necessary because otherwise yVector is modified
                const residualSumOfSquares = residuals.transpose().mmul(residuals).get(0, 0);
                const degreesOfFreedom = finalX.length - activeIndices.length;
                logWarning(`Degrees of freedom: ${degreesOfFreedom}`, warnings);

                if (degreesOfFreedom <= 0) {
                    const finalWarn = `Degrees of freedom is less than or equal to zero, choose a higher dependency threshold, fewer rules, or a bigger dataset! Current diagonal values of QR decomposition: ${diagElements.toString()}.`;
                    logWarning(finalWarn, warnings);
                    throw new Error(`Regression solve failed: ${finalWarn}`);
                }

                const sigmaSquared = residualSumOfSquares / degreesOfFreedom;

                // Compute covariance matrix
                let RInv: Matrix;
                try {
                    RInv = inverse(R);
                } catch (error) {
                    const finalWarn = `Failed to invert R matrix from QR decomposition. Consider increasing regularization.`;
                    logWarning(finalWarn, warnings);
                    throw new Error(`Regression solve failed: ${finalWarn}`);
                }
                const XtXInv = RInv.mul(RInv.transpose());
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
                        if (metadata.include_intercept !== false && idx === 0) {
                            // Skip the intercept column
                            return;
                        }
                        insignificantIndices.push(idx);
                    }
                });

                if (removedByStatProperties || !removeInsignificantRules || insignificantIndices.length === 0) {
                    break;
                }

                const rulesToRemove: number[] = insignificantIndices.map(idx => activeIndices[idx]);

                const warnMessages = rulesToRemove.map(ruleIdx => {
                    const rule = allRules[ruleIdx];
                    return {
                        log: `Removed rule "${rule.toString(metadata.target_var)}" due to insignificance (p-value: ${pValues[activeIndices.indexOf(ruleIdx)].toFixed(4)}).`,
                    };
                });

                warnCollector.push(...warnMessages);

                // Remove insignificant rules from activeIndices
                activeIndices = activeIndices.filter(idx => !rulesToRemove.includes(idx));
                attempts += rulesToRemove.length;
                removedByStatProperties = metadata.only_one_round_of_statistical_removal;
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
                const row = R.getRow(depIdx);
                const top3Indices = getTopThreeIndices(row);
                const top3Rules = top3Indices.map(itemId => ({
                    rule: allRules[activeIndices[itemId]].toString(metadata.target_var),
                    coefficient: row[itemId]
                }));

                if (top3Rules.some(r => r.coefficient == null))
                    throw new Error("Coefficient is null");

                warnMessages.push({
                    log: `Removed rule "${rule.toString(metadata.target_var)}" due to linear dependence (small QR R diagonal value ${diagElements[depIdx].toExponential()}).`,
                    top3LinearDependentRules: top3Rules,
                });
            });

            if (rulesToRemove.length > 0) {
                // Remove problematic rules from activeIndices
                activeIndices = activeIndices.filter(idx => !rulesToRemove.includes(idx));
                attempts += rulesToRemove.length;
                logWarning(warnMessages, warnings);
                removedLinearities = metadata.only_one_round_of_linearity_removal;
                continue; // Retry with the reduced set of rules
            }
        } else {
            // QR decomposition failed without a valid decomposition
            if (activeIndices.length === 0) {
                const finalWarn = `Unable to resolve linear dependencies with current threshold ${dependencyThreshold}.`;
                logWarning(finalWarn, warnings);
                throw new Error(`Regression solve failed: ${finalWarn}`);
            }

            // Remove the last rule
            const ruleIdx = activeIndices.pop()!;
            const rule = allRules[ruleIdx];
            const warnMsg = `Removed rule "${rule.toString(metadata.target_var)}" due to QR decomposition failure.`;
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

    logWarning(warnCollector, warnings);
}
