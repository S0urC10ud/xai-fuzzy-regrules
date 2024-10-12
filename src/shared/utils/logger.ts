export function logWarning(message: any, warnings: any[]) {
    warnings.push(message);
    console.warn(message);
}