import { Matrix, inverse } from "ml-matrix";
import { Metadata, Rule } from "../types/index";
import { logWarning } from "../utils/logger";
import tCDF from "@stdlib/stats-base-dists-t-cdf";
import normalCDF from "@stdlib/stats-base-dists-normal-cdf";

/**
 * Selects vectors based on orthogonalization and dependency threshold.
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
 * Computes the dot product of two vectors.
 */
function dotProduct(v1: number[], v2: number[]): number {
  return v1.reduce((sum, val, i) => sum + val * v2[i], 0);
}

/**
 * Computes the Euclidean norm of a vector.
 */
function norm(v: number[]): number {
  return Math.sqrt(dotProduct(v, v));
}

/**
 * Subtracts one vector from another.
 */
function vectorSubtract(v1: number[], v2: number[]): number[] {
  return v1.map((val, i) => val - v2[i]);
}

/**
 * Multiplies a vector by a scalar.
 */
function scalarMultiply(v: number[], scalar: number): number[] {
  return v.map((val) => val * scalar);
}

/**
 * Applies the soft-thresholding operator.
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
 * Performs LASSO regression using coordinate descent.
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
  const yVector = new Matrix(y.map((v) => [v]));

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
    logWarning(
      `Lasso did not converge after ${maxIter} iterations - maximum difference: ${maxDiff}`,
      warnings
    );

  return beta;
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

    warnings.push({
      "Removed Rules from priority filtering": selectedRuleIndices
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
  } else if (selectedRuleIndices.length > finalX.length) {
    const finalWarn = `Too many rules (${selectedRuleIndices.length} > ${finalX.length}) selected after vector selection with dependency threshold ${metadata.rule_filters.dependency_threshold}. Either filter more rules or provide a bigger dataset.`;
    logWarning(finalWarn, warnings);
    throw new Error(`Regression solve failed: ${finalWarn}`);
  }

  let activeIndices: number[] = selectedRuleIndices;
  const lambda = metadata.lasso.regularization || 0;
  const yVector = finalY;

  const warnCollector: any[] = [];

  // Prepare the submatrix for the selected features
  const subMatrixData: number[][] = finalX.map((row) =>
    activeIndices.map((col) => row[col])
  );
  const XMatrix = new Matrix(subMatrixData);
  const X = XMatrix.to2DArray();

  const maxLassoIterations = metadata.lasso.max_lasso_iterations ?? 10000;
  const lassoConvergenceTolerance =
    metadata.lasso.lasso_convergance_tolerance ?? 1e-4;

  // Perform Lasso regression using coordinate descent
  let coefficients = lassoCoordinateDescent(
    X,
    yVector,
    lambda,
    lassoConvergenceTolerance,
    maxLassoIterations,
    warnings
  );

  if (coefficients === null) {
    const finalWarn = `Regression coefficients could not be computed.`;
    logWarning(finalWarn, warnings);
    throw new Error(`Regression solve failed: ${finalWarn}`);
  }

  // Define the threshold for coefficient significance
  const significanceThreshold = 1e-5;

  // Identify significant and insignificant coefficients
  const significantIndices: number[] = [];
  let filteredCoeffs = coefficients.filter(
    (_, idx) => Math.abs(coefficients[idx]) >= significanceThreshold
  );
  const tooLowCoefficients: string[] = [];

  coefficients.forEach((coef, idx) => {
    if (Math.abs(coef) >= significanceThreshold)
      significantIndices.push(activeIndices[idx]);
    else
      tooLowCoefficients.push(
        allRules[activeIndices[idx]].toString(metadata.target_var)
      );
  });

  warnCollector.push({
    "Removed from pValue-computation due to low coefficient (<1e-5)":
      tooLowCoefficients,
  });

  activeIndices = significantIndices;

  // Initialize all coefficients and p-values to zero and null respectively
  allRules.forEach((rule) => {
    rule.coefficient = 0;
    rule.pValue = null;
  });

  if (activeIndices.length === 0) {
    logWarning(
      `All coefficients are below the significance threshold (${significanceThreshold}). No p-values computed.`,
      warnings
    );
    return;
  }

  if (metadata.compute_pvalues) {
    // Prepare the submatrix for significant features
    const significantSubMatrixData: number[][] = finalX.map((row) =>
      activeIndices.map((col) => row[col])
    );
    const significantXMatrix = new Matrix(significantSubMatrixData);
    const significantX = significantXMatrix.to2DArray();

    // Compute residuals
    const filteredCoeffsMatrix = new Matrix(filteredCoeffs.map((c) => [c]));
    const predictedY = significantXMatrix.mmul(filteredCoeffsMatrix);
    const residualsMatrix = new Matrix(yVector.map((y) => [y])).sub(predictedY);
    const residualSumOfSquares = residualsMatrix
      .transpose()
      .mmul(residualsMatrix)
      .get(0, 0);
    const degreesOfFreedom = yVector.length - filteredCoeffs.length;

    if (degreesOfFreedom <= 0) {
      const finalWarn = `Degrees of freedom is less than or equal to zero. Consider choosing a higher dependency threshold, fewer rules, or a bigger dataset!`;
      logWarning(finalWarn, warnings);
      throw new Error(`Regression solve failed: ${finalWarn}`);
    }

    const sigmaSquared = residualSumOfSquares / degreesOfFreedom;

    let pValues: number[] | null = null;
    if (metadata.lasso.regularization > 0 && activeIndices.length > 0) {
      // TODO: Compute p-values using debiased Lasso

      // Compute the debiasing matrix \hat{\Theta} using Nodewise Lasso
      const n = significantX.length; // number of samples

      const Sigma = computeSampleCovariance(significantX, n); // Compute Sigma = (1/n) X^T X

      const Theta = computeDebiasingMatrix(
        significantX,
        metadata.lasso.regularization
      );

      // Compute residuals
      const residuals = yVector.map((y, i) => y - predictedY.get(i, 0));

      // Form the debiased estimator
      const betaLasso = filteredCoeffs;
      const debiasedBeta = computeDebiasedEstimator(
        betaLasso,
        Theta,
        significantX,
        residuals,
        n
      );

      // Estimate asymptotic variance \hat{\Omega} = \hat{\Theta} \Sigma \hat{\Theta}^T
      const ThetaMatrix = Theta;
      const Omega = ThetaMatrix.mmul(Sigma).mmul(ThetaMatrix.transpose());

      // Compute standard errors
      const residualVariance = residuals.reduce((sum, r) => sum + r * r, 0) / n;
      const sigma = Math.sqrt(residualVariance);
      const standardErrors = Omega.diagonal().map(
        (se) => sigma * Math.sqrt(se / n)
      );

      // Compute z-statistics
      const zStatistics = debiasedBeta.map((beta, idx) =>
        standardErrors[idx] !== 0 ? beta / standardErrors[idx] : 0
      );

      // Compute p-values using standard normal distribution
      pValues = zStatistics.map((z) => 2 * (1 - normalCDF(Math.abs(z), 0, 1)));
    } else if (
      metadata.lasso.regularization === 0 &&
      activeIndices.length > 0
    ) {
      try {
        const XtX = new Matrix(significantX)
          .transpose()
          .mmul(new Matrix(significantX));
        let XtXInv: Matrix;
        try {
          XtXInv = inverse(XtX);
        } catch (error) {
          const identity = Matrix.eye(XtX.rows);
          XtXInv = inverse(XtX.add(identity.mul(1e-8)));
        }

        const covarianceMatrix = XtXInv.mul(sigmaSquared);

        // Compute standard errors
        const standardErrors = covarianceMatrix
          .diagonal()
          .map((se) => (se > 0 ? Math.sqrt(se) : 0));

        // Compute t-statistics and p-values
        const tStatistics = filteredCoeffs.map((coef, idx) =>
          standardErrors[idx] !== 0 ? coef / standardErrors[idx] : 0
        );
        pValues = tStatistics.map(
          (tStat) => 2 * (1 - tCDF(Math.abs(tStat), degreesOfFreedom))
        );
      } catch (error) {
        logWarning(
          `Failed to compute p-values using OLS: ${(error as Error).message}`,
          warnings
        );
        pValues = null;
      }
    }

    if (metadata.rule_filters.remove_insignificant_rules && pValues !== null) {
      const significanceLevel = metadata.rule_filters.significance_level;
      const filteredIndices: number[] = [];
      const filteredCoeffsV2: number[] = [];
      const filteredPvalues: number[] = [];
      const insignificantRules: object[] = [];
      pValues.forEach((pValue, idx) => {
        if (pValue !== null && pValue < significanceLevel) {
          filteredIndices.push(activeIndices[idx]);
          filteredCoeffsV2.push(filteredCoeffs[idx]);
          filteredPvalues.push(pValue);
        } else {
          insignificantRules.push({
            title: allRules[activeIndices[idx]].toString(metadata.target_var),
            leverage: allRules[activeIndices[idx]].leverage,
            support: allRules[activeIndices[idx]].support,
            coefficient: filteredCoeffs[idx],
            pValue: pValue,
          });
        }
      });

      if (insignificantRules.length > 0) {
        warnings.push({
          "Removed Insignificant Rules": insignificantRules,
        });
      }

      activeIndices = filteredIndices;
      filteredCoeffs = filteredCoeffsV2;
      pValues = filteredPvalues;
    }

    // Assign computed coefficients and p-values to the corresponding rules
    activeIndices.forEach((ruleIdx, idx) => {
      const rule = allRules[ruleIdx];
      rule.coefficient = filteredCoeffs[idx];
      if (pValues !== null && pValues[idx] !== undefined) {
        rule.pValue = pValues[idx];
      }
    });
  } else {
    // Assign coefficients without computing p-values
    let counter = 0;
    activeIndices.forEach((ruleIdx, idx) => {
      const rule = allRules[ruleIdx];
      if (Math.abs(filteredCoeffs[idx]) < significanceThreshold) {
        throw new Error(
          `Regression solve failed: Coefficient ${coefficients[idx]} is below the significance threshold ${significanceThreshold}.`
        );
      }

      rule.coefficient = filteredCoeffs[idx];
      rule.pValue = null;
      counter += 1;
    });
  }

  logWarning(warnCollector, warnings);
}

// New functions added for debiased Lasso

function computeSampleCovariance(X: number[][], n: number): Matrix {
  const XMatrix = new Matrix(X);
  const Xt = XMatrix.transpose();
  const Sigma = Xt.mmul(XMatrix).div(n);
  return Sigma;
}

function computeDebiasingMatrix(X: number[][], lambda: number): Matrix {
  const n = X.length;
  const p = X[0].length;
  const Theta = Matrix.zeros(p, p);

  for (let j = 0; j < p; j++) {
    // Get X_j
    const X_j = X.map((row) => row[j]);

    // Get X_{-j}
    const X_minus_j = X.map((row) => row.filter((_, idx) => idx !== j));

    // Perform Lasso regression of X_j onto X_{-j}
    const gamma = lassoCoordinateDescent(X_minus_j, X_j, lambda);

    // Compute residuals
    const X_j_pred = X_minus_j.map((row) =>
      row.reduce((sum, val, idx) => sum + val * gamma[idx], 0)
    );
    const residuals = X_j.map((val, idx) => val - X_j_pred[idx]);

    // Compute residual variance
    const tau_j_squared =
      residuals.reduce((sum, val) => sum + val * val, 0) / n;

    if (tau_j_squared === 0) {
      // Handle division by zero
      throw new Error(`Residual variance is zero for variable ${j}`);
    }

    // Set Theta[j][j]
    Theta.set(j, j, 1 / tau_j_squared);

    // Set Theta[j][k] for k != j
    let idxInGamma = 0;
    for (let k = 0; k < p; k++) {
      if (k !== j) {
        const gamma_k = gamma[idxInGamma];
        Theta.set(j, k, -gamma_k / tau_j_squared);
        idxInGamma++;
      }
    }
  }

  return Theta;
}

function computeDebiasedEstimator(
  beta: number[],
  Theta: Matrix,
  X: number[][],
  residuals: number[],
  n: number
): number[] {
  const XMatrix = new Matrix(X);
  const residualsMatrix = new Matrix(residuals.map((r) => [r]));
  const correction = Theta.mmul(XMatrix.transpose())
    .mmul(residualsMatrix)
    .div(n);
  const betaMatrix = new Matrix(beta.map((b) => [b]));
  const debiasedBetaMatrix = betaMatrix.add(correction);
  return debiasedBetaMatrix.getColumn(0);
}
