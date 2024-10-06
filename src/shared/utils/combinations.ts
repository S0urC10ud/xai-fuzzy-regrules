export function getCombinations<T>(array: T[], combinationSize: number): T[][] {
    const results: T[][] = [];
    const recurse = (start: number, combo: T[]) => {
        if (combo.length === combinationSize) {
            results.push([...combo]);
            return;
        }
        for (let i = start; i < array.length; i++) {
            combo.push(array[i]);
            recurse(i + 1, combo);
            combo.pop();
        }
    };
    recurse(0, []);
    return results;
}

export function cartesianProduct<T>(...arrays: T[][]): T[][] {
    return arrays.reduce<T[][]>((acc, curr) => {
        const res: T[][] = [];
        acc.forEach(a => {
            curr.forEach(b => {
                res.push([...a, b]);
            });
        });
        return res;
    }, [[]]);
}
