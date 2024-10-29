type MembershipDegrees = {
    [key: string]: number;
};

export function computeMembershipDegrees(
    x: number,
    min: number,
    max: number,
    classes: string[]
): MembershipDegrees {
    const allowedClasses = ["verylow", "low", "mediumlow", "medium", "mediumhigh", "high", "veryhigh"];

    const sortedClasses = classes
        .filter(cls => allowedClasses.includes(cls))
        .sort((a, b) => allowedClasses.indexOf(a) - allowedClasses.indexOf(b));

    if (classes.filter(cls => !allowedClasses.includes(cls)).length > 0) {
        throw new Error("Invalid (de-)fuzzification classes provided. Valid classes are: verylow, low, mediumlow, medium, mediumhigh, high, veryhigh.");
    }

    const numClasses = sortedClasses.length;
    if (![3, 5, 6, 7].includes(numClasses)) {
        throw new Error("Number of classes must be either 3, 5, 6, or 7.");
    }

    const range = max - min;
    const step = range / (numClasses - 1);

    const peaks = Array.from({ length: numClasses }, (_, i) => min + i * step);

    const triangles = peaks.map((peak, i) => {
        const left = i === 0 ? min : peaks[i - 1];
        const right = i === numClasses - 1 ? max : peaks[i + 1];
        return { left, peak, right };
    });

    const triangle = (x: number, left: number, peak: number, right: number): number => {
        if (x === peak) return 1;
        if (x < left || x > right) return 0;
        if (x < peak) {
            return (x - left) / (peak - left);
        } else {
            return (right - x) / (right - peak);
        }
    };

    // Compute raw membership degrees
    const rawDegrees: number[] = triangles.map(({ left, peak, right }) => triangle(x, left, peak, right));

    // Ensure first and last class peak at min and max
    rawDegrees[0] = x <= min ? 1 : rawDegrees[0];
    rawDegrees[numClasses - 1] = x >= max ? 1 : rawDegrees[numClasses - 1];

    // Normalize the degrees so that their sum is 1
    const sumDegrees = rawDegrees.reduce((sum, degree) => sum + degree, 0);
    const normalizedDegrees = sumDegrees === 0 ? rawDegrees.map(() => 0) : rawDegrees.map(degree => degree / sumDegrees);

    const membershipDegrees: MembershipDegrees = {};
    sortedClasses.forEach((cls, idx) => {
        membershipDegrees[cls] = parseFloat(normalizedDegrees[idx].toFixed(4)); // Rounded for readability
    });

    return membershipDegrees;
}