import { Matrix, inverse } from 'ml-matrix';
import { Metadata, Rule } from '../types/index';
import { logWarning } from '../utils/logger';
import tCDF from '@stdlib/stats-base-dists-t-cdf';

/**
 * Select vectors based on orthogonal basis and dependency threshold.
 */
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
            ruledOutWarnings.push({
                "Rule": ruleTitle,
                "Residual Norm": parseFloat(residualNorm.toFixed(4))
            });
        }
    }
    logWarning({"Removed due to low Gram-Schmidt residual norm (linear dependency)": ruledOutWarnings}, warnings);
    return keptIndices;
}

/**
 * Compute the dot product of two vectors.
 */
function dotProduct(v1: number[], v2: number[]): number {
    return v1.reduce((sum, val, i) => sum + val * v2[i], 0);
}

/**
 * Compute the Euclidean norm of a vector.
 */
function norm(v: number[]): number {
    return Math.sqrt(dotProduct(v, v));
}

/**
 * Subtract vector v2 from v1.
 */
function vectorSubtract(v1: number[], v2: number[]): number[] {
    return v1.map((val, i) => val - v2[i]);
}

/**
 * Multiply a vector by a scalar.
 */
function scalarMultiply(v: number[], scalar: number): number[] {
    return v.map(val => val * scalar);
}

/**
 * Soft-thresholding operator for Lasso.
 */
function softThresholding(value: number, lambda: number): number {
    if (value > lambda) {
        return value - lambda;
    } else if (value < -lambda) {
        return value + lambda;
    } else {
        return 0;
    }
}

/**
 * Perform Lasso regression using coordinate descent.
 */
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
 * Perform Ordinary Least Squares (OLS) regression to compute p-values.
 */
function olsRegression(
    X: number[][],
    y: number[]
): { coefficients: number[], pValues: number[] } {
    const XMatrix = new Matrix(X);
    const yMatrix = new Matrix(y.map(v => [v]));
    const Xt = XMatrix.transpose();
    let XtX = Xt.mmul(XMatrix).to2DArray();
    let XtXInv: Matrix;
    try {
        XtXInv = inverse(Xt.mmul(XMatrix));
    } catch (error) {
        // Regularization to make XtX invertible
        const identity = Matrix.eye(Xt.mmul(XMatrix).rows);
        XtXInv = inverse(Xt.mmul(XMatrix).add(identity.mul(1e-8)));
    }

    const XtY = Xt.mmul(yMatrix).to2DArray();
    const coefficients = XtXInv.mmul(XtY).to2DArray().map(row => row[0]);

    // Compute predictions and residuals
    const predictions = XMatrix.mmul(new Matrix(coefficients.map(c => [c])));
    const residuals = yMatrix.sub(predictions);
    const residualSumOfSquares = residuals.transpose().mmul(residuals).get(0, 0);
    const degreesOfFreedom = X.length - coefficients.length;

    if (degreesOfFreedom <= 0) {
        throw new Error(`Degrees of freedom is less than or equal to zero.`);
    }

    const sigmaSquared = residualSumOfSquares / degreesOfFreedom;

    // Compute covariance matrix
    const covarianceMatrix = XtXInv.mul(sigmaSquared);

    // Compute standard errors
    const standardErrors = covarianceMatrix.diagonal().map(se => (se > 0 ? Math.sqrt(se) : 0));

    // Compute t-statistics and p-values
    const tStatistics = coefficients.map((coef, idx) =>
        standardErrors[idx] !== 0 ? coef / standardErrors[idx] : 0
    );
    const pValues = tStatistics.map(tStat =>
        2 * (1 - tCDF(Math.abs(tStat), degreesOfFreedom))
    );

    return { coefficients, pValues };
}

/**
 * Performs regression with Lasso regularization to optimize for sparsity
 * and computes p-values using OLS on the selected predictors.
 * @param finalX - The design matrix with samples as rows and rules as columns.
 * @param finalY - The target vector.
 * @param allRules - Array of all possible rules.
 * @param metadata - Metadata containing regression parameters like regularization.
 * @param warnings - Array to collect warnings during the process.
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
            "Removed Rules": selectedRuleIndices.filter(r => allRules[r].priority < minPriority && !allRules[r].isIntercept).map(r => allRules[r].toString(metadata.target_var))
        });
        
        selectedRuleIndices = selectedRuleIndices.filter(
            idx => allRules[idx].isIntercept || allRules[idx].priority >= minPriority
        );

        if (selectedRuleIndices.length === 0) {
            const finalWarn = `No rules selected after priority filtering with minimum priority ${minPriority}.`;
            logWarning(finalWarn, warnings);
            throw new Error(`Regression solve failed: ${finalWarn}`);
        }

        if (selectedRuleIndices.length > finalX.length) {
            const finalWarn = `Too many rules (${selectedRuleIndices.length} > ${finalX.length}) selected after priority- and linearity-filtering with minimum priority ${minPriority}. Either filter more rules or provide a bigger dataset.`;
            logWarning(finalWarn, warnings);
            throw new Error(`Regression solve failed: ${finalWarn}`);
        }
    } else {
        if (selectedRuleIndices.length > finalX.length) {
            const finalWarn = `Too many rules (${selectedRuleIndices.length} > ${finalX.length}) selected after vector selection with dependency threshold ${metadata.rule_filters.dependency_threshold}. Either filter more rules or provide a bigger dataset.`;
            logWarning(finalWarn, warnings);
            throw new Error(`Regression solve failed: ${finalWarn}`);
        }
    }

    let activeIndices: number[] = selectedRuleIndices;
    const lambda = metadata.lasso.regularization || 0;
    const yVector = finalY;

    // First Round Lasso to filter out small coefficients
    const subMatrixDataFirstRound: number[][] = finalX.map(row => activeIndices.map(col => row[col]));
    const XMatrixFirstRound = new Matrix(subMatrixDataFirstRound);
    const XFirstRound = XMatrixFirstRound.to2DArray();

    const maxLassoIterations = metadata.lasso.max_lasso_iterations ?? 10000;
    const lassoConvergenceTolerance = metadata.lasso.lasso_convergance_tolerance ?? 1e-4;

    // Perform initial Lasso regression
    const initialCoefficients = lassoCoordinateDescent(XFirstRound, yVector, lambda, lassoConvergenceTolerance, maxLassoIterations, warnings);

    // Filter out coefficients with absolute value < 1e-4
    const filteredIndices = initialCoefficients
        .map((coef, idx) => ({ coef, idx }))
        .filter(item => Math.abs(item.coef) >= 1e-4)
        .map(item => activeIndices[item.idx]);

    if (filteredIndices.length === 0) {
        const finalWarn = `All coefficients were filtered out after initial Lasso regression with lambda ${lambda}.`;
        logWarning(finalWarn, warnings);
        throw new Error(`Regression solve failed: ${finalWarn}`);
    }

    activeIndices = filteredIndices;

    // Prepare the submatrix for the filtered features
    const subMatrixDataFiltered: number[][] = finalX.map(row => activeIndices.map(col => row[col]));
    const XMatrixFiltered = new Matrix(subMatrixDataFiltered);
    const XFiltered = XMatrixFiltered.to2DArray();

    // Perform Lasso regression again on the filtered set to ensure sparsity
    const finalLassoCoefficients = lassoCoordinateDescent(XFiltered, yVector, lambda, lassoConvergenceTolerance, maxLassoIterations, warnings);

    // Identify non-zero coefficients after final Lasso
    const nonZeroIndices = finalLassoCoefficients
        .map((coef, idx) => ({ coef, idx }))
        .filter(item => Math.abs(item.coef) >= 1e-4)
        .map(item => activeIndices[item.idx]);

    if (nonZeroIndices.length === 0) {
        const finalWarn = `All coefficients were zero after final Lasso regression with lambda ${lambda}.`;
        logWarning(finalWarn, warnings);
        throw new Error(`Regression solve failed: ${finalWarn}`);
    }

    activeIndices = nonZeroIndices;

    // Prepare the submatrix for the final selected features
    const subMatrixDataFinal: number[][] = finalX.map(row => activeIndices.map(col => row[col]));
    const XMatrixFinal = new Matrix(subMatrixDataFinal);
    const XFinal = XMatrixFinal.to2DArray();

    // Perform Lasso regression one more time to get final coefficients
    const finalCoefficients = lassoCoordinateDescent(XFinal, yVector, lambda, lassoConvergenceTolerance, maxLassoIterations, warnings);

    // Perform OLS on the selected predictors to compute p-values
    let pValues: number[] = [];
    try {
        const olsResult = olsRegression(XFinal, yVector);
        // Align the coefficients from OLS with the Lasso coefficients
        // This assumes that OLS coefficients are the best estimates after selection
        for (let i = 0; i < activeIndices.length; i++) {
            allRules[activeIndices[i]].coefficient = olsResult.coefficients[i];
            allRules[activeIndices[i]].pValue = olsResult.pValues[i];
        }
    } catch (error) {
        logWarning(`OLS regression failed: ${error}`, warnings);
        // As a fallback, assign Lasso coefficients without p-values
        activeIndices.forEach((ruleIdx, idx) => {
            const rule = allRules[ruleIdx];
            rule.coefficient = finalCoefficients[idx];
            rule.pValue = null;
        });
    }

    // Set coefficients and p-values for non-selected rules to zero and null respectively
    selectedRuleIndices.forEach(ruleIdx => {
        if (!activeIndices.includes(ruleIdx)) {
            const rule = allRules[ruleIdx];
            rule.coefficient = 0;
            rule.pValue = null;
        }
    });
}
