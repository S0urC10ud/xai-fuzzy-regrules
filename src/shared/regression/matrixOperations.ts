import { Matrix } from 'ml-matrix';

export function computeRegularizedXtX(X_matrix: Matrix, lambda: number): Matrix {
    const Xt = X_matrix.transpose();
    const XtX = Xt.mmul(X_matrix);
    const identityMatrix = Matrix.eye(XtX.rows).mul(lambda);
    return XtX.add(identityMatrix);
}

export function computeXtY(X_matrix: Matrix, y_vector: Matrix): Matrix {
    const Xt = X_matrix.transpose();
    return Xt.mmul(y_vector);
}
