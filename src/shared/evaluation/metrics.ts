export function computeMetrics(finalY: number[], y_pred: number[]): any {
    const n = finalY.length;

    const mae =
        finalY.reduce((acc, val, idx) => acc + Math.abs(val - y_pred[idx]), 0) / n;
    const mse =
        finalY.reduce(
            (acc, val, idx) => acc + Math.pow(val - y_pred[idx], 2),
            0
        ) / n;
    const rmse = Math.sqrt(mse);

    const meanY = finalY.reduce((acc, val) => acc + val, 0) / n;
    const ssTot = finalY.reduce((acc, val) => acc + Math.pow(val - meanY, 2), 0);
    const ssRes = finalY.reduce(
        (acc, val, idx) => acc + Math.pow(val - y_pred[idx], 2),
        0
    );
    const rSquared = 1 - ssRes / ssTot;

    const epsilon = 1e-10;
    const mape =
        (finalY.reduce((acc, val, idx) => {
            return acc + Math.abs((val - y_pred[idx]) / (Math.abs(val) + epsilon));
        }, 0) /
            n) *
        100;

    return {
        mean_absolute_error: mae,
        root_mean_squared_error: rmse,
        r_squared: rSquared,
        mean_absolute_percentage_error: mape,
    };
}