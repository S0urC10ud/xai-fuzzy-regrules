import wandb
import requests
import json

DEST_PORT = 3000

config = {
    "target_var": "Salary",
    "compute_pvalues": True,
    "outlier_filtering": {
        "Salary": {
            "method": "VariableBounds",
            "min": 25000,
            "max": 85000
        }
    },
    "split_char": ";",
    "lasso": {
        "regularization": 1,
        "max_lasso_iterations": 1000,
        "lasso_convergance_tolerance": 1e-3
    },
    "rule_filters": {
        "l1_column_threshold": 0.1,
        "l1_row_threshold": 0.1,
        "dependency_threshold": 0,
        "significance_level": 0.05,
        "remove_insignificant_rules": False,
        "only_whitelist": False,
        "rule_priority_filtering": {
            "enabled": True,
            "min_priority": 0.04
        }
    },
    "numerical_fuzzification": ["veryhigh", "high", "medium", "low", "verylow"],
    "numerical_defuzzification": ["veryhigh", "high", "medium", "low", "verylow"],
    "variance_threshold": 1e-5,
    "num_vars": 2,
    "whitelist": [],
    "blacklist": [],
    "remove_low_variance": False,
    "include_intercept": True,
    "rule_priority_weights": {
        "support_weight": 1,
        "leverage_weight": 10,
        "num_antecedents_weight": 0,
        "whitelist_boolean_weight": 1000
    }
}

# Define the sweep configuration
sweep_config = {
    "method": "grid",  # "random" or "bayes" as needed
    "metric": {
        "name": "average_important_rule_pValues",  
        "goal": "minimize"
    },
    "parameters": {
        "lasso.regularization": {
            "values": [0.0001, 0.001, 0.01, 0.1, 0.5, 1, 5, 10, 50, 100, 500, 1000]
        },
        "lasso.max_lasso_iterations": {
            "values": [50, 500, 1000, 2500, 5000, 10000, 100000]
        },
        "lasso.lasso_convergance_tolerance": {
            "values": [1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7]
        }
    }
}

# sweep_id = wandb.sweep(sweep_config, project="FuzzyXAI-biasedSalaries-2Antecedents")
important_rules = ["If Gender is female then Salary is verylow", "If Gender is female then Salary is low", "If HiringManager is B AND If Gender is other then Salary is high", "If Gender is male then Salary is high"]
short_rules = {
    important_rules[0]: "femaleLow",
    important_rules[1]: "femaleVeryLow",
    important_rules[2]: "HmBotherHigh",
    important_rules[3]: "maleHigh"
}

def train():
    run = wandb.init()
    
    config["lasso"]["regularization"] = run.config["lasso.regularization"]
    config["lasso"]["max_lasso_iterations"] = run.config["lasso.max_lasso_iterations"]
    config["lasso"]["lasso_convergance_tolerance"] = run.config["lasso.lasso_convergance_tolerance"]

    with open("assets/biased_salaries.csv", "rb") as csv_file:
        files = {
            "metadata": (None, json.dumps(config), "application/json"),
            "csvFile": ("your_file.csv", csv_file, "text/csv")
        }
        response = requests.post("http://localhost:3000/api/upload", files=files, timeout=3600).json()
        
        wandb.log({
            "num_active_rules": response["num_active_rules"],
            "runtime": response.get("runtime", 0)  # Placeholder if runtime is available in response
        })

        important_rule_pValues = []
        
        for rule in important_rules:
            hm_rule = next((r for r in response["sorted_rules"] if r["title"] == rule), None)
            if hm_rule:
                wandb.log({
                    f"{short_rules[rule]}_coefficient": hm_rule["coefficient"],
                    f"{short_rules[rule]}_pValue": hm_rule.get("pValue", None)  # log pValue if available
                })
                important_rule_pValues.append(hm_rule.get("pValue", 1))
            else:
                important_rule_pValues.append(1)
        
        wandb.log({
            "average_important_rule_pValues": sum(important_rule_pValues)/len(important_rule_pValues)
        })

        with open('response.json', 'w') as f:
            json.dump(response, f)
        artifact = wandb.Artifact('response_artifact', type='response')
        artifact.add_file('response.json')
        wandb.log_artifact(artifact)


if __name__ == "__main__":
    # read optional dest port from command line
    import sys
    if len(sys.argv) > 1:
        DEST_PORT = int(sys.argv[1])
        print(f"Using port {DEST_PORT}")
    
    wandb.agent("0sqbe7jc", train, project = "FuzzyXAI-biasedSalaries-2Antecedents")
    