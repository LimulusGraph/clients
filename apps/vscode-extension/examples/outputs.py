"""md
# Experiment results

Compare loss over three epochs. Run this file as a graph node to display
its text, table, and plot in the preview.
"""
import pandas as pd
import matplotlib.pyplot as plt

print("Training complete")
results = pd.DataFrame({"epoch": [1, 2, 3], "loss": [0.8, 0.4, 0.2]})
display(results)

plt.plot(results["epoch"], results["loss"], marker="o")
plt.xlabel("Epoch")
plt.ylabel("Loss")
plt.title("Training loss")
plt.show()

results.describe()
