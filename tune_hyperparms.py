import wandb
import requests
import json
import subprocess
import os
import threading
from time import sleep
import random
import socket

DEST_PORT = 3000
script_dir = os.path.dirname(os.path.abspath(__file__))
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
        "lasso_convergence_tolerance": 1e-3
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
            "min_priority": 0.01
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

sweep_config = {
    "method": "bayes",  # "random" or "bayes" as needed
    "metric": {
        "name": "average_important_rule_pValues",  
        "goal": "minimize"
    },
    "parameters": {
        "lasso.regularization": {
            "values": [5, 10, 15, 20, 25, 35, 42, 50, 65, 75, 80, 90, 100, 110, 125, 130, 150]
        },
        "lasso.max_lasso_iterations": {
            "values": [50, 500, 1000, 2500, 5000, 10000, 100000]
        },
        "lasso.lasso_convergence_tolerance": {
            "values": [1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7]
        }
    }
}

#sweep_id = wandb.sweep(sweep_config, project="FuzzyXAIbiasedSalariesUpdated")
important_rules = ["If Gender is female then Salary is verylow", "If Gender is female then Salary is low", "If HiringManager is B AND If Gender is other then Salary is high", "If Gender is other then Salary is medium", "If Gender is other then Salary is low"]
short_rules = {
    important_rules[0]: "femaleVeryLow",
    important_rules[1]: "femaleLow",
    important_rules[2]: "HmBotherHigh",
    important_rules[3]: "otherMedium",
    important_rules[4]: "otherLow"
}

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('localhost', port)) == 0

def train():
    # Start the Node backend
    while True:
        DEST_PORT = random.randint(3000, 40000)
        if not is_port_in_use(DEST_PORT):
            break

    env = os.environ.copy()
    env["PORT"] = str(DEST_PORT)
    server_process = subprocess.Popen(['C:\\Program Files\\nodejs\\npm.cmd', 'run', 'start'], env=env, cwd=script_dir)
    sleep(30)
    def stop_server():
        server_process.kill()
        server_process.wait()

    timer = threading.Timer(3600, stop_server)
    timer.start()

    try:
        run = wandb.init()
        
        config["lasso"]["regularization"] = run.config["lasso.regularization"]
        config["lasso"]["max_lasso_iterations"] = run.config["lasso.max_lasso_iterations"]
        config["lasso"]["lasso_convergence_tolerance"] = run.config["lasso.lasso_convergence_tolerance"]

        with open("assets/biased_salaries.csv", "rb") as csv_file:
            files = {
                "metadata": (None, json.dumps(config), "application/json"),
                "csvFile": ("assets/biased_salaries.csv", csv_file, "text/csv")
            }
            response = requests.post(f"http://localhost:{DEST_PORT}/api/upload", files=files, timeout=3600).json()
            
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
            
            # get the lowest 4 important rule pValues
            lowest_4 = sorted(important_rule_pValues)[0:4]
            wandb.log({
                "average_important_rule_pValues": sum(lowest_4)/len(lowest_4)
            })

            with open('response.json', 'w') as f:
                json.dump(response, f)
            artifact = wandb.Artifact('response_artifact', type='response')
            artifact.add_file('response.json')
            wandb.log_artifact(artifact)
    except Exception as e:
        print(e)
    finally:
        timer.cancel()
        stop_server()

if __name__ == "__main__":
    wandb.agent("jyuhe62c", train, project = "FuzzyXAIbiasedSalariesUpdated")