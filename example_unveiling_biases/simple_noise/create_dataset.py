import pandas as pd
import numpy as np
import os

np.random.seed(12)
n_samples = 3000

data = {
    'target_generator': np.linspace(0,5,n_samples)
}

for i in range(1, 5):
    data[f'RANDOM{i}'] = np.random.uniform(-3, 2, n_samples)

df = pd.DataFrame(data)

df['target'] = df['target_generator']

output_path = os.path.join(os.path.dirname(__file__), 'simple_dataset.csv')
df.to_csv(output_path, sep=";", index=False)