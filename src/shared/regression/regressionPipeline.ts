import { Matrix, solve } from 'ml-matrix';
import { Rule } from '../types';
import { attemptToSolve } from './solver';
import { logWarning } from '../utils/logger';

export function performRegression(
    finalX: number[][],
    finalY: number[],
    allRules: Rule[],
    metadata: any,
    warnings: string[]
): number[] {
    const X_matrix = new Matrix(finalX); // design matrix [rows, cols]
    const y_vector = Matrix.columnVector(finalY); // [rows, 1]

    const XtX = X_matrix.transpose().mmul(X_matrix); // [cols, cols]
    const lambda = metadata.regularization;
    const identityMatrix = Matrix.eye(XtX.rows).mul(lambda);
    const XtX_reg = XtX.add(identityMatrix); // [cols, cols]

    const Xt_y = X_matrix.transpose().mmul(y_vector); // [cols, 1]

    let coeffsArray: number[] | null;

    try {
        const coeffs = solve(XtX_reg, Xt_y);
        coeffsArray = coeffs.to1DArray();
    } catch (error) {
        coeffsArray = attemptToSolve(XtX_reg, Xt_y, allRules, metadata, warnings);
        if (coeffsArray === null) {
            const finalWarn = `Unable to solve the regression problem even after removing all possible rules.`;
            logWarning(finalWarn, warnings);
            throw new Error(`Regression solve failed: ${finalWarn}`);
        }
    }

    return coeffsArray;
}
