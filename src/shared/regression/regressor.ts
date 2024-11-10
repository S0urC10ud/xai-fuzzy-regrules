import { Matrix, inverse } from "ml-matrix";
import { Metadata, Rule } from "../types/index";
import { logWarning } from "../utils/logger";
import tCDF from "@stdlib/stats-base-dists-t-cdf";

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

/**
 * Estimates the precision matrix using node-wise LASSO.
 * This is part of the Desparsified LASSO procedure.
 */
function estimatePrecisionMatrix(
  X: number[][],
  lambdaNode: number,
  tol = 1e-4,
  maxIter = 10000,
  warnings: any[] = []
): Matrix {
  const n = X.length;
  const p = X[0].length;
  const Theta = Matrix.zeros(p, p);

  for (let j = 0; j < p; j++) {
    // Prepare the data for node-wise regression
    const Xj = X.map((row) => row[j]);
    const X_minus_j = X.map((row) => row.filter((_, idx) => idx !== j));

    // Perform LASSO regression to predict Xj from X_minus_j
    const beta_j = lassoCoordinateDescent(
      X_minus_j,
      Xj,
      lambdaNode,
      tol,
      maxIter,
      warnings
    );

    // Compute the residuals
    const XjMatrix = new Matrix(Xj.map((v) => [v]));
    const XMinusJMatrix = new Matrix(X_minus_j);
    const predictions = XMinusJMatrix.mmul(new Matrix([beta_j]).transpose())
      .to2DArray()
      .map((row) => row[0]);
    const residuals = XjMatrix.sub(new Matrix(predictions.map((v) => [v])))
      .to2DArray()
      .map((row) => row[0]);

    // Compute the scaling factor
    const residualSumOfSquares = residuals.reduce(
      (sum, val) => sum + val * val,
      0
    );
    const tau = residualSumOfSquares / n;

    // Fill the Theta matrix
    Theta.set(j, j, 1 / tau);
    for (let k = 0; k < p; k++) {
      if (k !== j) {
        Theta.set(j, k, -beta_j[k < j ? k : k - 1]);
      }
    }
  }

  return Theta;
}

/**
 * Performs regression with LASSO regularization and computes p-values using Desparsified LASSO.
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
    const minPriority =
      metadata.rule_filters.rule_priority_filtering.min_priority;

    // Add warnings for the removed rules
    warnings.push({
      "Removed Rules": selectedRuleIndices
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
  const coefficients = lassoCoordinateDescent(
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
  const filteredCoeffs = coefficients.filter((_, idx) => Math.abs(coefficients[idx]) >= significanceThreshold);
  const tooLowCoefficients: string[] = [];

  coefficients.forEach((coef, idx) => {
    if (Math.abs(coef) >= significanceThreshold)
      significantIndices.push(activeIndices[idx]);
    else
      tooLowCoefficients.push(allRules[activeIndices[idx]].toString(metadata.target_var));
  });

  warnCollector.push({
    "Removed from pValue-computation due to low coefficient (<1e-5)": tooLowCoefficients,
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

  const lambdaParam = metadata.compute_pvalues ? lambda : 0;

  if (metadata.compute_pvalues) {
    // Prepare the submatrix for significant features
    const significantSubMatrixData: number[][] = finalX.map((row) =>
      activeIndices.map((col) => row[col])
    );
    const significantXMatrix = new Matrix(significantSubMatrixData);
    const significantX = significantXMatrix.to2DArray();

    // Compute residuals
    const predictedY = significantXMatrix.mmul(new Matrix([coefficients.filter((_, idx) => Math.abs(coefficients[idx]) >= significanceThreshold)].flatMap(c => [c])).transpose());
    const residualsMatrix = new Matrix(yVector.map((y) => [y])).sub(predictedY);
    const residualSumOfSquares = residualsMatrix
      .transpose()
      .mmul(residualsMatrix)
      .get(0, 0);
    const degreesOfFreedom =
      yVector.length - coefficients.filter((coef) => Math.abs(coef) >= significanceThreshold).length;

    if (degreesOfFreedom <= 0) {
      const finalWarn = `Degrees of freedom is less than or equal to zero. Consider choosing a higher dependency threshold, fewer rules, or a bigger dataset!`;
      logWarning(finalWarn, warnings);
      throw new Error(`Regression solve failed: ${finalWarn}`);
    }

    const sigmaSquared = residualSumOfSquares / degreesOfFreedom;

    let pValues: number[] | null = null;
    if (lambdaParam > 0 && activeIndices.length > 0) {
      // Estimate the precision matrix using node-wise LASSO
      const lambdaNode = lambdaParam;
      const Theta = estimatePrecisionMatrix(
        significantX,
        lambdaNode,
        lassoConvergenceTolerance,
        maxLassoIterations,
        warnings
      );

      // Compute X^T * residual / n
      const residualVector = residualsMatrix.to2DArray().map((row) => row[0]);
      const XtResidualMatrix = new Matrix(
        new Matrix(significantX).transpose().mmul(new Matrix(residualVector.map((v) => [v])))
      );
      const XtResidual = XtResidualMatrix.to2DArray().map((row) =>
        row.map((val: number) => val / X.length)
      );

      // Convert Theta to 2D array for matrix multiplication
      const ThetaArray = Theta.to2DArray();

      // Compute Theta * (X^T * residual / n)
      const correction: number[] = ThetaArray.map((row) =>
        row.reduce((sum, val, idx) => sum + val * XtResidual[idx][0], 0)
      );

      // Compute de-biased coefficients: beta_d = beta_Lasso + correction
      const betaDebiased: number[] = coefficients
        .filter((_, idx) => Math.abs(coefficients[idx]) >= significanceThreshold)
        .map((beta_j, idx) => beta_j + correction[idx]);

      // Compute standard errors: sqrt(Theta[j][j] * sigmaSquared / n)
      const standardErrors: number[] = ThetaArray.map((row, idx) =>
        row[idx] > 0 ? Math.sqrt((row[idx] * sigmaSquared) / X.length) : 0
      );

      // Compute t-statistics and p-values
      const tStatistics = betaDebiased.map((beta_d, idx) =>
        standardErrors[idx] !== 0 ? beta_d / standardErrors[idx] : 0
      );
      pValues = tStatistics.map(
        (tStat) => 2 * (1 - tCDF(Math.abs(tStat), degreesOfFreedom))
      );
    } else if (lambdaParam === 0 && activeIndices.length > 0) {
      try {
        const XtX = new Matrix(significantX).transpose().mmul(new Matrix(significantX));
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
        const tStatistics = coefficients
          .filter((_, idx) => Math.abs(coefficients[idx]) >= significanceThreshold)
          .map((coef, idx) =>
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
      if(Math.abs(filteredCoeffs[idx]) < significanceThreshold) {
        throw new Error(`Regression solve failed: Coefficient ${coefficients[idx]} is below the significance threshold ${significanceThreshold}.`);
      }

      rule.coefficient = filteredCoeffs[idx];
      rule.pValue = null;
      counter += 1;
    });
  }

  logWarning(warnCollector, warnings);
}