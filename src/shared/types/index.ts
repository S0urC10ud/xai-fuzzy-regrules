export interface Metadata {
    target_var: string;
    outlier_filtering?: {
        [key: string]: {
            method: "IQR" | "VariableBounds";
            outlier_iqr_multiplier?: number;
            min?: number;
            max?: number;
        };
    };
    split_char: string;
    regularization: number;
    l1_column_threshold: number;
    l1_row_threshold: number;
    numerical_fuzzification: FuzzySet[];
    numerical_defuzzification: FuzzySet[];
    variance_threshold: number;
    num_vars: number;
    whitelist?: string[];
    blacklist?: string[];
    only_whitelist?: boolean;
    remove_low_variance?: boolean;
    dependency_threshold: number;
}

export type Record = { [key: string]: string | number };

export type Antecedent = {
    variable: string;
    fuzzySet: string;
};

export type FuzzySet = 'verylow' | 'low' | 'mediumlow' | 'medium' | 'mediumhigh' | 'high' | 'veryhigh';

export class Rule {
    antecedents: { variable: string; fuzzySet: string }[];
    outputFuzzySet: string;
    isWhitelist: boolean;

    constructor(
        antecedents: { variable: string; fuzzySet: string }[],
        outputFuzzySet: string,
        isWhitelist: boolean
    ) {
        this.antecedents = antecedents;
        this.outputFuzzySet = outputFuzzySet;
        this.isWhitelist = isWhitelist;
    }

    toString(target_var: string): string {
        const antecedentStr = this.antecedents
            .map((ant) => `If ${ant.variable} is ${ant.fuzzySet}`)
            .join(' AND ');
        return `${antecedentStr} then ${target_var} is ${this.outputFuzzySet}`;
    }
}

export type EvaluationMetrics = {
    sorted_rules: { rule: string; coefficient: number }[];
    mean_absolute_error: number;
    root_mean_squared_error: number;
    r_squared: number;
    mean_absolute_percentage_error: number;
    warnings: any[];
};
