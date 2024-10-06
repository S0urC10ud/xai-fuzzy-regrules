export function hashRow(row: number[], threshold: number): string {
    const numDimensions = row.length;
    const precision = threshold / numDimensions / 2;
    return row.map(value => Math.round(value / precision)).join('_');
}

export function hashColumn(column: number[], threshold: number): string {
    const numElements = column.length;
    const precision = threshold / numElements / 2;
    return column.map(value => Math.round(value / precision)).join('_');
}
