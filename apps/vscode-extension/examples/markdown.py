#!/usr/bin/env python3
"""md
# A small training experiment

This is a **normal Python file**. Comments provide the explanation,
and the code runs as one script in each universe.

## Prepare the data

- Start with three observations.
- Compare two scale factors.
- Keep the experiment easy to reproduce.
"""

# This is a regular Python comment, shown with syntax highlighting.
observations = [1, 2, 3]

"""md
## Choose a model

| Parameter | Value |
| --- | --- |
| Scale | 2 |
| Metric | Absolute error |

> Change `scale` in the source editor and rerun the node.
"""

scale = 2
predictions = [scale * value for value in observations]

"""md
## Inspect the result

The predictions should be:

```text
[2, 4, 6]
```

See [Prepare the data](#prepare-the-data) for the input values.
"""

print(predictions)  # Inline comments stay with the code.

message = """# This text belongs to a Python string.
# It is not rendered as Markdown.
"""
