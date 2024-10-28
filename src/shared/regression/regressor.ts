import { Matrix, inverse } from 'ml-matrix';
import { Metadata, Rule } from '../types';
import { logWarning } from '../utils/logger';
import tCDF from '@stdlib/stats-base-dists-t-cdf';

function selectVectors(
    vectors: number[][],
    allRules: Rule[],
    metadata: Metadata,
    warnings: any
): number[] {
    const threshold = metadata.rule_filters.dependency_threshold;
    const keptIndices: number[] = [];
    const orthogonalBasis: number[][] = [];
    const basisUsedToRuleOut: { [key: number]: number[] } = {};
    const ruledOutWarnings: any[] = [];

    for (let i = 0; i < vectors.length; i++) {
        const currentVector = vectors[i];
        let residual = currentVector.slice(); // Clone the current vector
        const rulingOutBasis: number[] = [];

        // Project the current vector onto the existing orthogonal basis
        for (let j = 0; j < orthogonalBasis.length; j++) {
            const basisVector = orthogonalBasis[j];
            const projectionCoefficient =
                dotProduct(residual, basisVector) / dotProduct(basisVector, basisVector);
            const projection = scalarMultiply(basisVector, projectionCoefficient);
            residual = vectorSubtract(residual, projection);

            if (norm(residual) <= threshold) {
                rulingOutBasis.push(keptIndices[j]); // Record basis vector index that contributed
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
            const ruleTitle = allRules[i].toString(metadata.target_var);
            ruledOutWarnings.push(
                `Rule "${ruleTitle}" ruled out due to linear dependency (Gram-Schmidt residual norm: ${residualNorm.toFixed(
                    4
                )}).`
            );
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

function softThresholding(value: number, lambda: number): number {
    if (value > lambda) {
        return value - lambda;
    } else if (value < -lambda) {
        return value + lambda;
    } else {
        return 0;
    }
}

function lassoCoordinateDescent(
    X: number[][],
    y: number[],
    lambda: number,
    tol = 1e-4,
    maxIter = 10000,
    warnings: any[] = []
): number[] {
    const p = X[0].length;
    let beta = new Array(p).fill(0);
    let betaOld = new Array(p).fill(0);
    const XMatrix = new Matrix(X);
    const yVector = new Matrix(y.map(v => [v]));

    // Precompute X^T X and X^T y
    const XtX = XMatrix.transpose().mmul(XMatrix).to2DArray();
    const Xty = XMatrix.transpose().mmul(yVector).getColumn(0);

    let converged = false;
    let iter = 0;
    let maxDiff = 0;
    while (!converged && iter < maxIter) {
        iter++;
        for (let j = 0; j < p; j++) {
            let residual = Xty[j];
            for (let k = 0; k < p; k++) {
                if (k !== j) {
                    residual -= XtX[j][k] * beta[k];
                }
            }
            const z = XtX[j][j];

            // Update beta_j using the soft-thresholding operator
            beta[j] = softThresholding(residual, lambda) / z;
        }

        // Check convergence
        maxDiff = 0;
        for (let j = 0; j < p; j++) {
            const diff = Math.abs(beta[j] - betaOld[j]);
            if (diff > maxDiff) {
                maxDiff = diff;
            }
            betaOld[j] = beta[j];
        }

        if (maxDiff < tol) {
            converged = true;
        }
    }

    if (iter === maxIter)
        logWarning(`Lasso did not converge after ${maxIter} iterations - maximum difference: ${maxDiff}`, warnings);
    
    return beta;
}

/**
 * Performs regression with Lasso regularization to optimize for sparsity,
 * including p-value computations (approximate).
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
    if (
        metadata.rule_filters.dependency_threshold !== undefined &&
        metadata.rule_filters.dependency_threshold > 0
    ) {
        selectedRuleIndices = selectVectors(
            new Matrix(finalX).transpose().to2DArray(),
            allRules,
            metadata,
            warnings
        );
    } else {
        selectedRuleIndices = Array.from({ length: finalX[0].length }, (_, i) => i);
    }
    if (selectedRuleIndices.length === 0) {
        const finalWarn = `No rules selected after vector selection with dependency threshold ${metadata.rule_filters.dependency_threshold}.`;
        logWarning(finalWarn, warnings);
        throw new Error(`Regression solve failed: ${finalWarn}`);
    }

    if (metadata.rule_filters.rule_priority_filtering?.enabled) {
        const minPriority = metadata.rule_filters.rule_priority_filtering.min_priority;
        
        // Add warnings for the removed rules
        warnings.push({
            "Removed Rules": selectedRuleIndices.filter(r => allRules[r].priority < minPriority).map(r => {allRules[r].toString(metadata.target_var)})
        });
        
        selectedRuleIndices = selectedRuleIndices.filter(
            idx => idx == 0 || allRules[idx].priority >= minPriority
        );

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
    const lambda = metadata.regularization || 0;
    const yVector = finalY;

    const warnCollector: any[] = [];

    // Prepare the submatrix for the selected features
    const subMatrixData: number[][] = finalX.map(row => activeIndices.map(col => row[col]));
    const XMatrix = new Matrix(subMatrixData);
    const X = XMatrix.to2DArray();

    const maxLassoIterations = metadata.max_lasso_iterations || 10000;
    // Perform Lasso regression using coordinate descent
    const coefficients = lassoCoordinateDescent(X, yVector, lambda, 1e-4, maxLassoIterations, warnings);

    if (coefficients === null) {
        const finalWarn = `Regression coefficients could not be computed.`;
        logWarning(finalWarn, warnings);
        throw new Error(`Regression solve failed: ${finalWarn}`);
    }

    // Compute predicted y values
    const predictedY = XMatrix.mmul(new Matrix([coefficients]).transpose());
    const residuals = new Matrix(yVector.map(y => [y])).sub(predictedY);
    const residualSumOfSquares = residuals.transpose().mmul(residuals).get(0, 0);
    const degreesOfFreedom = yVector.length - coefficients.filter(coef => coef !== 0).length;

    if (degreesOfFreedom <= 0) {
        const finalWarn = `Degrees of freedom is less than or equal to zero. Consider choosing a higher dependency threshold, fewer rules, or a bigger dataset!`;
        logWarning(finalWarn, warnings);
        throw new Error(`Regression solve failed: ${finalWarn}`);
    }

    const sigmaSquared = residualSumOfSquares / degreesOfFreedom;

    // Approximate covariance matrix (Note: This is not exact for Lasso - hence excluded for lasso)
    let pValues: number[]|null = null;
    if(lambda == 0) {
        const XtX = XMatrix.transpose().mmul(XMatrix);
        let XtXInv: Matrix;
        try {
            XtXInv = inverse(XtX);
        } catch (error) {
            // Regularization to make XtX invertible
            const identity = Matrix.eye(XtX.rows);
            XtXInv = inverse(XtX.add(identity.mul(1e-8)));
        }

        const covarianceMatrix = XtXInv.mul(sigmaSquared);

        // Compute standard errors
        const standardErrors = covarianceMatrix.diagonal().map(se => (se > 0 ? Math.sqrt(se) : 0));

        // Compute t-statistics and p-values
        const tStatistics = coefficients.map((coef, idx) =>
            standardErrors[idx] !== 0 ? coef / standardErrors[idx] : 0
        );
        pValues = tStatistics.map(tStat =>
            2 * (1 - tCDF(Math.abs(tStat), degreesOfFreedom))
        );
    }

    // Initialize all coefficients and p-values to zero and one respectively
    allRules.forEach(rule => {
        rule.coefficient = 0;
    });

    // Assign computed coefficients and p-values to the corresponding rules
    activeIndices.forEach((ruleIdx, idx) => {
        const rule = allRules[ruleIdx];
        rule.coefficient = coefficients[idx];
        if (pValues !== null)
            rule.pValue = pValues[idx];
    });

    logWarning(warnCollector, warnings);
}
