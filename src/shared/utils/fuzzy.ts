export function computeMembershipDegrees(x: number, min: number, q1: number, q2: number, max: number): { low: number, medium: number, high: number } {
    let low = 0, medium = 0, high = 0;

    if (x <= q1) {
        if (q1 === min) {
            low = 1;
            medium = high = 0;
        } else {
            low = 1 - (x - min) / (q1 - min);
            medium = (x - min) / (q1 - min);
            high = 0;
        }
    } else if (x > q1 && x <= q2) {
        low = 0;
        medium = 1;
        high = 0;
    } else {
        if (q2 === max) {
            low = medium = 0;
            high = 1;
        } else {
            low = 0;
            medium = 1 - (x - q2) / (max - q2);
            high = (x - q2) / (max - q2);
        }
    }
    return { low, medium, high };
}