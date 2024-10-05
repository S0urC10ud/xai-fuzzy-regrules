export function computeMembershipDegrees(x: number, min: number, max: number): {
    verylow: number,
    low: number,
    mediumlow: number,
    medium: number,
    mediumhigh: number,
    high: number,
    veryhigh: number
} {
    const range = max - min;
    const step = range / 6; // Divide the range into 6 equal parts for 7 classes

    // Define the key points
    const p0 = min;
    const p1 = min + step;
    const p2 = min + 2 * step;
    const p3 = min + 3 * step;
    const p4 = min + 4 * step;
    const p5 = min + 5 * step;
    const p6 = max;

    // Helper function for triangular membership
    const triangle = (x: number, left: number, peak: number, right: number): number => {
        if (x === peak) return 1;
        if (x < left || x > right) return 0;
        if (x < peak) {
            return (x - left) / (peak - left);
        } else {
            return (right - x) / (right - peak);
        }
    };

    // Compute membership degrees
    const verylow = x <= p1 ? (p1 - x) / step : 0;

    const low = triangle(x, p0, p1, p2);

    const mediumlow = triangle(x, p1, p2, p3);

    const medium = triangle(x, p2, p3, p4);

    const mediumhigh = triangle(x, p3, p4, p5);

    const high = triangle(x, p4, p5, p6);

    const veryhigh = x >= p5 ? (x - p5) / step : 0;

    // Ensure all memberships are within [0,1]
    const clamp = (value: number) => Math.max(0, Math.min(1, value));

    return {
        verylow: clamp(verylow),
        low: clamp(low),
        mediumlow: clamp(mediumlow),
        medium: clamp(medium),
        mediumhigh: clamp(mediumhigh),
        high: clamp(high),
        veryhigh: clamp(veryhigh)
    };
}
