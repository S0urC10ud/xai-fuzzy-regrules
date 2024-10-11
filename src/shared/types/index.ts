export type Metadata = {
    target_var: string;
    split_char: string;
    regularization: number;
    l1_column_threshold: number;
    l1_row_threshold: number;
    numerical_fuzzification: FuzzySet[];
    numerical_defuzzification: FuzzySet[];
    variance_threshold: number;
    outlier_iqr_multiplier: number;
    num_vars: number;
    whitelist?: string[];
    blacklist?: string[];
    only_whitelist?: boolean;
    outlier_bounds?: { [key: string]: { lower: number; upper: number } };
    enable_outlier_removal?: boolean;
};

export type Record = { [key: string]: string | number };

export type Antecedent = {
    variable: string;
    fuzzySet: string;
};

export type FuzzySet = 'verylow' | 'low' | 'mediumlow' | 'medium' | 'mediumhigh' | 'high' | 'veryhigh';

export type Rule = {
    antecedents: Antecedent[];
    outputFuzzySet: FuzzySet;
    isWhitelist: boolean;
};

export type EvaluationMetrics = {
    sorted_rules: { rule: string; coefficient: number }[];
    mean_absolute_error: number;
    root_mean_squared_error: number;
    r_squared: number;
    mean_absolute_percentage_error: number;
    warnings: string[];
};
