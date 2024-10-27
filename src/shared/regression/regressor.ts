import { Matrix, QrDecomposition, SVD, inverse, solve } from 'ml-matrix';
import { Metadata, Rule } from '../types';
import { logWarning } from '../utils/logger';
import tCDF from '@stdlib/stats-base-dists-t-cdf';

function selectVectors(vectors: number[][], allRules: Rule[], metadata: Metadata, warnings: any): number[] {
    const threshold = metadata.rule_filters.dependency_threshold;
    const keptIndices: number[] = [];
    const orthogonalBasis: number[][] = [];
    const basisUsedToRuleOut: { [key: number]: number[] } = {};
    const ruledOutWarnings: any[] = [];

    for (let i = 0; i < vectors.length; i++) {
        const currentVector = vectors[i];
        let residual = currentVector.slice(); // Clone the current vector
        const rulingOutBasis: number[] = [];  // Track basis vectors that rule out this vector

        // Project the current vector onto the existing orthogonal basis
        for (let j = 0; j < orthogonalBasis.length; j++) {
            const basisVector = orthogonalBasis[j];
            const projectionCoefficient = dotProduct(residual, basisVector) / dotProduct(basisVector, basisVector);
            const projection = scalarMultiply(basisVector, projectionCoefficient);
            residual = vectorSubtract(residual, projection);

            if (norm(residual) <= threshold) {
                rulingOutBasis.push(keptIndices[j]);  // Record basis vector index that contributed
            }
        }

        const residualNorm = norm(residual);

        // If the residual norm is greater than the threshold, keep the vector
        if (residualNorm > threshold) {
            keptIndices.push(i);
            // Store the basis vectors that ruled out linear dependency for the current vector
            basisUsedToRuleOut[i] = [...rulingOutBasis];

            // Normalize the residual and add it to the orthogonal basis
            const normalizedResidual = scalarMultiply(residual, 1 / residualNorm);
            orthogonalBasis.push(normalizedResidual);
        } else {
            const ruleTitle = allRules[i].toString(metadata.target_var);  // Get the rule title
            ruledOutWarnings.push(`Rule "${ruleTitle}" ruled out due to linear dependency (Gram-Schmidt residual norm: ${residualNorm.toFixed(4)}).`);
        }
    }
    logWarning(ruledOutWarnings, warnings);
    return keptIndices;
}

function dotProduct(v1: number[], v2: number[]): number {
    return v1.reduce((sum, val, i) => sum + val * v2[i], 0);
}

function norm(v: number[]): number {
    return Math.sqrt(dotProduct(v, v));
}

function vectorSubtract(v1: number[], v2: number[]): number[] {
    return v1.map((val, i) => val - v2[i]);
}

function scalarMultiply(v: number[], scalar: number): number[] {
    return v.map(val => val * scalar);
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
    metadata: Metadata,
    warnings: any[]
): void {
    let selectedRuleIndices: number[] = [];
    if(metadata.rule_filters.dependency_threshold !== undefined && metadata.rule_filters.dependency_threshold > 0) {
        selectedRuleIndices = selectVectors(new Matrix(finalX).transpose().to2DArray(), allRules, metadata, warnings);
    } else {
        selectedRuleIndices = Array.from({length: finalX[0].length}, (_, i) => i);
    }
    if (selectedRuleIndices.length === 0) {
        const finalWarn = `No rules selected after vector selection with dependency threshold ${metadata.rule_filters.dependency_threshold}.`;
        logWarning(finalWarn, warnings);
        throw new Error(`Regression solve failed: ${finalWarn}`);
    }

    if (metadata.rule_filters.rule_priority_filtering?.enabled) {
        const minPriority = metadata.rule_filters.rule_priority_filtering.min_priority;
        selectedRuleIndices = selectedRuleIndices.filter(idx => allRules[idx].priority >= minPriority);

        if (selectedRuleIndices.length === 0) {
            const finalWarn = `No rules selected after priority filtering with minimum priority ${minPriority}.`;
            logWarning(finalWarn, warnings);
            throw new Error(`Regression solve failed: ${finalWarn}`);
        }

        if (selectedRuleIndices.length > finalX.length) {
            const finalWarn = `Too many rules selected after priority- and linearity-filtering with minimum priority ${minPriority}, it should be increased.`;
            logWarning(finalWarn, warnings);
            throw new Error(`Regression solve failed: ${finalWarn}`);
        }
    } else {
        if (selectedRuleIndices.length > finalX.length) {
            const finalWarn = `Too many rules selected after vector selection with dependency threshold ${metadata.rule_filters.dependency_threshold}, it should be increased.`;
            logWarning(finalWarn, warnings);
            throw new Error(`Regression solve failed: ${finalWarn}`);
        }
    }

    let activeIndices: number[] = selectedRuleIndices;
    let attempts = 0;
    const maxAttempts = allRules.length;
    let lambda = metadata.regularization || 0;
    const significanceLevel = metadata.rule_filters.significance_level || 0.05;
    const removeInsignificantRules = metadata.rule_filters.remove_insignificant_rules || false;
    let coefficients: number[] | null = null;
    let pValues: number[] = [];
    const yVector = new Matrix(finalY.map(y => [y]));
    let removedByStatProperties = false;
    if (metadata.rule_filters.only_one_round_of_statistical_removal === undefined)
        metadata.rule_filters.only_one_round_of_statistical_removal = true;

    const warnCollector: any[] = [];

    while (attempts < maxAttempts) {
        const subMatrixData: number[][] = finalX.map(row => activeIndices.map(col => row[col]));
        const XMatrix = new Matrix(subMatrixData);

        const Xt = XMatrix.transpose();
        const XtX = Xt.mmul(XMatrix);
        const identity = Matrix.eye(XtX.rows);
        const XtXPlusLambdaI = XtX.clone().add(identity.mul(lambda));

        const XtY = Xt.mmul(yVector);
        let betaMatrix: Matrix;

        // Attempt to solve using QR Decomposition
        try {
            const qr = new QrDecomposition(XtXPlusLambdaI);
            betaMatrix = qr.solve(XtY);
        } catch (qrError) {
            logWarning(`QR Decomposition failed: ${qrError}. Attempting SVD-based solution.`, warnings);
            // Fallback to SVD-based solution
            try {
                const svd = new SVD(XtXPlusLambdaI, { autoTranspose: true });
                const pinv = svd.inverse();
                betaMatrix = new Matrix(pinv.mmul(XtY));
            } catch (svdError) {
                const finalWarn = `Both QR and SVD-based solutions failed. Consider increasing regularization or removing more linearly dependent rules (dependencyThreshold).`;
                logWarning(finalWarn, warnings);
                throw new Error(`Regression solve failed: ${finalWarn}`);
            }
        }

        coefficients = betaMatrix.to1DArray();

        const predictedY = XMatrix.mmul(betaMatrix);
        const residuals = yVector.clone().sub(predictedY);
        const residualSumOfSquares = residuals.transpose().mmul(residuals).get(0, 0);
        const degreesOfFreedom = finalX.length - activeIndices.length;
        logWarning(`Degrees of freedom: ${degreesOfFreedom}`, warnings);

        if (degreesOfFreedom <= 0) {
            const finalWarn = `Degrees of freedom is less than or equal to zero. Consider choosing a higher dependency threshold, fewer rules, or a bigger dataset!`;
            logWarning(finalWarn, warnings);
            throw new Error(`Regression solve failed: ${finalWarn}`);
        }

        const sigmaSquared = residualSumOfSquares / degreesOfFreedom;

        // Compute covariance matrix: (X^T X + lambda I)^-1 * sigmaSquared
        let XtXPlusLambdaIInv: Matrix;
        try {
            // Attempt to compute inverse using the inverse function
            XtXPlusLambdaIInv = inverse(XtXPlusLambdaI).mul(sigmaSquared);
        } catch (invError) {
            logWarning(`Matrix inversion failed using direct inversion: ${invError}. Attempting SVD-based inversion.`, warnings);
            // Fallback to SVD-based inversion
            try {
                const svd = new SVD(XtXPlusLambdaI, { autoTranspose: true });
                const pinv = svd.inverse();
                XtXPlusLambdaIInv = pinv.mul(sigmaSquared);
            } catch (svdError) {
                const finalWarn = `Failed to invert (X^T X + lambda I) using both direct inversion and SVD. Consider increasing regularization.`;
                logWarning(finalWarn, warnings);
                throw new Error(`Regression solve failed: ${finalWarn}`);
            }
        }

        // Compute standard errors
        const covarianceDiagonal = XtXPlusLambdaIInv.diagonal();
        const standardErrors = covarianceDiagonal.map(se => (se > 0 ? Math.sqrt(se) : 0));

        const tStatistics = coefficients.map((coef, idx) => (standardErrors[idx] !== 0 ? coef / standardErrors[idx] : 0));
        pValues = tStatistics.map(tStat =>
            2 * (1 - tCDF(Math.abs(tStat), degreesOfFreedom))
        );

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

        activeIndices = activeIndices.filter(idx => !rulesToRemove.includes(idx));
        attempts += rulesToRemove.length;
        removedByStatProperties = metadata.rule_filters.only_one_round_of_statistical_removal;
    }

    if (attempts >= maxAttempts) {
        const finalWarn = `Unable to resolve insignificance after removing ${attempts} rules.`;
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
