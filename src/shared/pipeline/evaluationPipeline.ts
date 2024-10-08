import { EvaluationMetrics } from '../types';
import { computeMetrics } from '../evaluation/metrics';

export function executeEvaluationPipeline(
    finalY: number[],
    y_pred: number[]
): EvaluationMetrics {
    const metrics = computeMetrics(finalY, y_pred);
    return metrics;
}