export function computeQuantiles(sorted: number[], q: number[]): number[] {
    return q.map((quantile) => {
        const pos = (sorted.length - 1) * quantile;
        const base = Math.floor(pos);
        const rest = pos - base;
        if (sorted[base + 1] !== undefined) {
            return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
        } else {
            return sorted[base];
        }
    });
}