export type Metadata = {
    target_var: string;
    split_char: string;
    regularization: number;
    l1_column_threshold: number;
    l1_row_threshold: number;
    numerical_fuzzification: string[];
    numerical_defuzzification: string[];
    variance_threshold: number;
    outlier_iqr_multiplier: number;
    num_vars: number;
    whitelist?: string[];
    blacklist?: string[];
    only_whitelist?: boolean;
};

export type Record = { [key: string]: string | number };

export type Antecedent = {
    variable: string;
    fuzzySet: 'verylow' | 'low' | 'mediumlow' | 'medium' | 'mediumhigh' | 'high' | 'veryhigh';
};

export type Rule = {
    antecedents: Antecedent[];
    outputFuzzySet: 'verylow' | 'low' | 'mediumlow' | 'medium' | 'mediumhigh' | 'high' | 'veryhigh';
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
