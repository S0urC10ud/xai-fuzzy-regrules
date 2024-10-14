import { Record, Metadata } from '../types';
import { computeMembershipDegrees } from '../utils/fuzzy';
import { generateFuzzificationChart } from '../utils/vis_fuzzification';

export function fuzzifyNumericalData(
    records: Record[],
    numericalKeys: string[],
    targetVar: string,
    metadata: Metadata,
    variableBounds: { [key: string]: { min: number; max: number } },
    warnings: any[]
): void {
    numericalKeys.forEach(key => {
        const values: number[] = records.map(record => parseFloat(record[key] as string));
        const { min, max } = variableBounds[key];

        if (key !== targetVar) {
            if(metadata.generate_fuzzification_chart)
                generateFuzzificationChart(values, min, max, key, metadata["numerical_fuzzification"]);

            records.forEach(record => {
                const x = parseFloat(record[key] as string);
                const degrees = computeMembershipDegrees(x, min, max, metadata["numerical_fuzzification"]);
                if (degrees.verylow !== undefined) record[`${key}_verylow`] = parseFloat(degrees.verylow.toFixed(4));
                if (degrees.low !== undefined) record[`${key}_low`] = parseFloat(degrees.low.toFixed(4));
                if (degrees.mediumlow !== undefined) record[`${key}_mediumlow`] = parseFloat(degrees.mediumlow.toFixed(4));
                if (degrees.medium !== undefined) record[`${key}_medium`] = parseFloat(degrees.medium.toFixed(4));
                if (degrees.mediumhigh !== undefined) record[`${key}_mediumhigh`] = parseFloat(degrees.mediumhigh.toFixed(4));
                if (degrees.high !== undefined) record[`${key}_high`] = parseFloat(degrees.high.toFixed(4));
                if (degrees.veryhigh !== undefined) record[`${key}_veryhigh`] = parseFloat(degrees.veryhigh.toFixed(4));
                delete record[key];
            });
        }
    });
}
