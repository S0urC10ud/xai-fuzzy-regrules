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
    lasso: {
        regularization: number;
        max_lasso_iterations?: number;
        lasso_convergance_tolerance?: number;
    }
    rule_filters: {
        l1_column_threshold: number;
        l1_row_threshold: number;
        dependency_threshold: number;
        significance_level: number;
        remove_insignificant_rules: boolean;
        only_whitelist?: boolean;
        only_one_round_of_statistical_removal?: boolean;
        only_one_round_of_linearity_removal?: boolean;
        rule_priority_filtering?: {
            enabled: boolean;
            min_priority: number;
        }
    };
    numerical_fuzzification: FuzzySet[];
    numerical_defuzzification: FuzzySet[];
    variance_threshold: number;
    num_vars: number;
    whitelist?: string[];
    blacklist?: string[];
    remove_low_variance?: boolean;
    include_intercept: boolean;
    rule_priority_weights?: {
        support_weight?:number;
        leverage_weight?:number;
        num_antecedents_weight?: number;
        whitelist_boolean_weight?: number;
    };
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
    support: number = 0;
    leverage: number = 0;
    priority: number = 0;
    isIntercept: boolean;
    columnIndex: number = -1;
    coefficient: number | null = null;
    pValue: number | null = null;
    secondaryRules: string[] = [];

    constructor(
        antecedents: { variable: string; fuzzySet: string }[],
        outputFuzzySet: string,
        isWhitelist: boolean,
        columnIndex: number = -1,
        isIntercept: boolean = false,
        support = 0,
        leverage = 0,
        priority = 0
    ) {
        this.antecedents = antecedents;
        this.outputFuzzySet = outputFuzzySet;
        this.isWhitelist = isWhitelist;
        this.isIntercept = isIntercept;
        this.columnIndex = columnIndex;
        this.support = support;
        this.leverage = leverage;
        this.priority = priority;
    }

    toString(target_var: string): string {
        //remove all special characters for output security
        target_var = target_var.replace(/[^a-zA-Z0-9]/g, '');
        if (this.isIntercept)
            return "Intercept";

        const antecedentStr = this.antecedents
            .map((ant) => `If ${ant.variable.replace(/[^a-zA-Z0-9]/g, '')} is ${ant.fuzzySet.replace(/[^a-zA-Z0-9]/g, '')}`)
            .join(' AND ');
        return `${antecedentStr} then ${target_var} is ${this.outputFuzzySet.replace(/[^a-zA-Z0-9]/g, '')}`;
    }
}


export type EvaluationMetrics = {
    sorted_rules:{
        title: string;
        coefficient: number|null;
        pValue: number|null;
        isWhitelist: boolean;
        support: number;
        leverage: number;
        priority: number;
    }[];
    mean_absolute_error: number;
    root_mean_squared_error: number;
    r_squared: number;
    mean_absolute_percentage_error: number;
    warnings: any[];
};
