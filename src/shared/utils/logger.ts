export function logWarning(message: string, warnings: string[]) {
    warnings.push(message);
    console.warn(message);
}