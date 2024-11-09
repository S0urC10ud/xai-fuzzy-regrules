import { Matrix } from "ml-matrix";
import { Metadata, Rule } from "../types/index";
import { logWarning } from "../utils/logger";
import expCDF from "@stdlib/stats-base-dists-exponential-cdf";

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
        dotProduct(residual, basisVector) /
        dotProduct(basisVector, basisVector);
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
        Rule: ruleTitle,
        "Residual Norm": parseFloat(residualNorm.toFixed(4)),
      });
    }
  }
  logWarning(
    {
      "Removed due to low Gram-Schmidt residual norm (linear dependency)":
        ruledOutWarnings,
    },
    warnings
  );
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
  return v.map((val) => val * scalar);
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
): { beta: number[]; betaPath: number[][]; lambdaPath: number[] } {
  const n = X.length;
  const p = X[0].length;
  let beta = new Array(p).fill(0);
  let betaOld = new Array(p).fill(0);
  const XMatrix = new Matrix(X);
  const yVector = new Matrix(y.map((v) => [v]));

  // Precompute X^T X and X^T y
  const XtX = XMatrix.transpose().mmul(XMatrix).to2DArray();
  const Xty = XMatrix.transpose().mmul(yVector).getColumn(0);

  let converged = false;
  let iter = 0;
  let maxDiff = 0;

  const betaPath: number[][] = [];
  const lambdaPath: number[] = [];

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

    // Record the beta coefficients
    betaPath.push([...beta]);
    lambdaPath.push(lambda);

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
    logWarning(
      `Lasso did not converge after ${maxIter} iterations - maximum difference: ${maxDiff}`,
      warnings
    );

  return { beta, betaPath, lambdaPath };
}

/**
 * Compute the covariance test statistic T_k for Lasso.
 */
function computeCovarianceStatistic(
  X: number[][],
  y: number[],
  betaFull: number[],
  betaActive: number[],
  sigmaSquared: number
): number {
  const n = y.length;
  const XMatrix = new Matrix(X);
  const yVector = new Matrix(y.map((v) => [v]));

  const yTy = yVector.transpose().mmul(yVector).get(0, 0);
  const XBetaFull = XMatrix.mmul(new Matrix(betaFull.map((b) => [b])));
  const XBetaActive = XMatrix.mmul(new Matrix(betaActive.map((b) => [b])));

  const innerProductFull = yVector.transpose().mmul(XBetaFull).get(0, 0);
  const innerProductActive = yVector.transpose().mmul(XBetaActive).get(0, 0);

  const T_k = (innerProductFull - innerProductActive) / sigmaSquared;

  return T_k;
}

/**
 * Estimate sigma squared using the residuals.
 */
function estimateSigmaSquared(y: number[], yHat: number[]): number {
  const residuals = y.map((yi, i) => yi - yHat[i]);
  const residualSumOfSquares = residuals.reduce((sum, r) => sum + r * r, 0);
  const degreesOfFreedom = y.length - 1;
  const sigmaSquared = residualSumOfSquares / degreesOfFreedom;
  return sigmaSquared;
}

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
    const minPriority =
      metadata.rule_filters.rule_priority_filtering.min_priority;

    // Add warnings for the removed rules
    warnings.push({
      "Removed Rules due to priority filtering": selectedRuleIndices
        .filter(
          (r) => allRules[r].priority < minPriority && !allRules[r].isIntercept
        )
        .map((r) => allRules[r].toString(metadata.target_var)),
    });

    selectedRuleIndices = selectedRuleIndices.filter(
      (idx) =>
        allRules[idx].isIntercept || allRules[idx].priority >= minPriority
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

  // Prepare the submatrix for the selected features
  const subMatrixData: number[][] = finalX.map((row) =>
    activeIndices.map((col) => row[col])
  );
  const XMatrix = new Matrix(subMatrixData);
  const X = XMatrix.to2DArray();

  const maxLassoIterations = metadata.lasso.max_lasso_iterations ?? 10000;
  const lassoConvergenceTolerance =
    metadata.lasso.lasso_convergance_tolerance ?? 1e-4;

  // Perform Lasso regression
  const { beta, betaPath, lambdaPath } = lassoCoordinateDescent(
    X,
    yVector,
    lambda,
    lassoConvergenceTolerance,
    maxLassoIterations,
    warnings
  );

  // Compute the estimated sigma squared
  const yHat = XMatrix.mmul(new Matrix(beta.map((b) => [b]))).getColumn(0);
  const sigmaSquared = estimateSigmaSquared(yVector, yHat);

  if (metadata.compute_pvalues) {
    // Initialize the active set and compute p-values using the covariance test
    const pValues: number[] = new Array(activeIndices.length).fill(1); // Default p-values to 1
    const activeSet: number[] = [];

    // We will compute T_k for each predictor entering the model
    for (let k = 0; k < activeIndices.length; k++) {
      // Active set before adding the k-th predictor
      const indicesBeforeK = activeIndices.slice(0, k);
      const indicesIncludingK = activeIndices.slice(0, k + 1);

      // Prepare X matrices
      const XActiveMatrix = new Matrix(
        finalX.map((row) => indicesBeforeK.map((idx) => row[idx]))
      );
      const XFullMatrix = new Matrix(
        finalX.map((row) => indicesIncludingK.map((idx) => row[idx]))
      );

      // Perform Lasso regression for the model including k-th predictor
      const XActive = XActiveMatrix.to2DArray();
      const XFull = XFullMatrix.to2DArray();

      const { beta: betaActive } = lassoCoordinateDescent(
        XActive,
        yVector,
        lambda,
        lassoConvergenceTolerance,
        maxLassoIterations,
        warnings
      );
      const { beta: betaFull } = lassoCoordinateDescent(
        XFull,
        yVector,
        lambda,
        lassoConvergenceTolerance,
        maxLassoIterations,
        warnings
      );

      // Extend betaActive to match the size of betaFull (pad with zeros)
      const betaActiveExtended = [...betaActive, 0];

      // Compute the covariance statistic T_k
      const T_k = computeCovarianceStatistic(
        XFull,
        yVector,
        betaFull,
        betaActiveExtended,
        sigmaSquared
      );

      // Compute p-value using the exponential distribution
      const pValue = 1 - expCDF(T_k, 1); // Exponential with mean 1

      pValues[k] = pValue;

      // Update the rule's pValue
      const ruleIdx = activeIndices[k];
      allRules[ruleIdx].pValue = pValue;
      allRules[ruleIdx].coefficient = betaFull[betaFull.length - 1]; // Coefficient of the k-th predictor
    }

    // For the remaining predictors (if any), assign coefficient and pValue
    for (let k = pValues.length; k < activeIndices.length; k++) {
      const ruleIdx = activeIndices[k];
      allRules[ruleIdx].pValue = null;
      allRules[ruleIdx].coefficient = 0;
    }

    // Remove insignificant rules if required
    if (metadata.rule_filters.remove_insignificant_rules) {
      const significanceLevel = metadata.rule_filters.significance_level;
      const insignificantIndices = activeIndices.filter(
        (idx, i) => pValues[i] > significanceLevel
      );
      if (insignificantIndices.length > 0) {
        warnings.push({
          "Removed Insignificant Rules": insignificantIndices.map((idx) =>
            allRules[idx].toString(metadata.target_var)
          ),
        });
        activeIndices = activeIndices.filter(
          (idx, i) => pValues[i] <= significanceLevel
        );
      }
    }
  } else {
    // Set pValues to null and coefficients as computed
    activeIndices.forEach((ruleIdx) => {
      allRules[ruleIdx].pValue = null;
      // Coefficient is already set from Lasso regression
    });

    // Set coefficients and p-values for non-selected rules to zero and null respectively
    selectedRuleIndices.forEach((ruleIdx) => {
      if (!activeIndices.includes(ruleIdx)) {
        const rule = allRules[ruleIdx];
        rule.coefficient = 0;
        rule.pValue = null;
      }
    });
  }
}
