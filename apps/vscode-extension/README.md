<p align="center">
  <img src="logo.jpg" alt="Limulus logo" width="200" />
</p>

<h1 align="center">Limulus for VS Code</h1>

<p align="center">
  <strong>Your experiments, inside your editor.</strong><br />
  Edit graphs, run Python universes, and inspect results in VS Code.
</p>

<p align="center">
  <a href="#requirements-and-installation">Get started</a> ·
  <a href="#create-and-edit-a-graph">Edit a graph</a> ·
  <a href="#code-output-previews">See your results</a>
</p>

---

The Limulus extension brings graph-based Python experiments into VS Code. Open
`.lmg` graphs as visual editors, click nodes to edit their Python files, and run
independent execution paths with the bundled backend.

| Edit in VS Code | Run your project | Inspect results |
| --- | --- | --- |
| Work with graph tabs, neighboring Python editors, Undo/Redo, and Command Palette actions. | Start the backend automatically and install project requirements into a local `.venv`. | Preview Markdown and highlighted code alongside prints, pandas tables, and Matplotlib plots. |

This guide covers the extension's installation, controls, previews, and settings.
For the universe model and the server-hosted browser interface, visit the
[Limulus project overview](https://github.com/LimulusGraph#readme).

## Requirements and installation

- VS Code 1.95 or later.
- macOS or Linux, with an extension package built for your OS and CPU.
- Python 3, with the packages needed by your project.

Install the `.vsix` package using **Extensions → … → Install from VSIX…**. The
package includes the execution backend, so running the extension does not require
Go, Node.js, npm, or a separately launched server.

Open a trusted project folder containing a `.lmg` file. The extension starts its
backend automatically. Python code runs only when you start an execution.

Set `limulus.pythonPath` to the base Python executable to use when creating
project environments. Python must include the `venv` and `ensurepip` modules.

## Create and edit a graph

Run **Limulus: New Graph** from the Command Palette and choose where to save the
`.lmg` file. To open a project, use **Limulus: Open Graph** or open its `.lmg` file
in Explorer. If it opens as JSON, choose **Reopen Editor With… → Limulus Graph**.

| Action | Behavior |
| --- | --- |
| **＋ Node** | Creates a node with a numeric ID from 1–9999 and a source file at `nodes/<id>.py`. |
| Click a node | Opens its Python file beside the graph. Pin the source tab to keep it open when selecting another node. |
| Drag a node | Changes its position. |
| Drag between handles | Connects two nodes. Connections that would create a cycle are rejected. |
| Double-click a connection | Enables or disables it. Disabled connections are excluded from execution paths. |
| **Rename** | Changes the selected node's title while keeping its ID and source filename. |
| **Delete selected** or Delete | Removes selected nodes or connections from the graph. Python files are retained. |
| **Limulus: Save Graph**, Undo, Redo | Uses VS Code's normal document editing workflow. |

Existing source files are never overwritten when adding nodes. Removing a node
or undoing its creation leaves its Python file available for reuse or inspection.

Save and dependency actions are available in the Command Palette. They target the
active graph, or let you choose a graph when several are open. Normal VS Code
saving (Ctrl+S / Cmd+S) also works.

## Project dependencies

On first execution, Limulus automatically creates `.venv/` beside the `.lmg`
file using Python's [venv module](https://docs.python.org/3/library/venv.html).
Every universe in that folder uses `.venv/bin/python`. Graph files in the same
folder share one environment; separate folders have separate environments.
An existing valid `.venv` is reused. Global Python packages are not inherited.

Run **Limulus: View Dependencies** from the Command Palette to open or create `requirements.txt` beside the graph.
List packages using [pip requirement syntax](https://pip.pypa.io/en/stable/cli/pip_install/):

```text
pandas>=2.0
matplotlib>=3.8
```

Run **Limulus: Install Dependencies** from the Command Palette to create the environment and run
`.venv/bin/python -m pip install -r requirements.txt` without executing nodes.
Ordinary runs also install requirements automatically on first use in the VS Code
session and whenever `requirements.txt` changes. Unsaved requirements are saved
before installation. Pip progress and errors appear in the graph output panel;
**Stop** cancels setup or installation. Failed installation prevents execution.

Use **Limulus: Install Dependencies** after changing included requirements files, local
package sources, or the environment outside Limulus. Dependency installation resets
live runtimes for graphs in that folder, so use **Run all** or **Run through node**
afterward. Runs sharing a folder wait for each other so pip cannot change packages
during execution; universes within a run still execute concurrently.

Commit `requirements.txt` with the project. The generated environment contains a
`.gitignore` that excludes its contents. Removing a requirement does not uninstall
an already installed package. To start clean or switch the base Python version,
reset runtimes, delete `.venv/`, update `limulus.pythonPath` if needed, and install
again. An incomplete or unrelated `.venv` folder is reported instead of overwritten.

## How universes execute

A universe is a complete root-to-leaf path through enabled connections. Each has
its own persistent Python process; nodes along that path share live variables,
functions, and classes. The extension exposes these execution controls:

| Control | Behavior |
| --- | --- |
| **Run all** | Starts fresh runtimes and executes every complete universe. |
| **Run through node** | Restarts each universe containing the selected node and executes its path through that node. |
| **Run cell** | Executes only the selected node in each matching live runtime. Its preceding nodes must already have run successfully. |
| **Stop** | Cancels the active execution. |
| **Reset runtimes** | Stops the project's Python runtimes and releases their state. |

Before execution, the extension saves the graph and any unsaved Python files
referenced by its nodes. The output panel below the graph shows execution events
and rich results, with filters for individual universes and nodes. It retains up
to 2,000 events or 20 MiB from the current run.

A failed node stops its universe and discards that runtime; other universes
continue. Closing a graph editor resets its runtimes. **Limulus: Restart Server**
resets all runtimes managed by the VS Code window.

Python memory is isolated between universes. Files, network services, and
accelerators are shared, so use distinct artifact paths when experiments write
results. Shared nodes run once per universe, including any external side effects.
Runtime state is not saved across resets or shutdown. Graphs are limited to 128
universes, and interactive stdin prompts are unsupported.

## Markdown previews in Python files

Use a standalone triple-quoted string beginning with `md` to embed Markdown:

```python
# Regular Python comment
scale = 2

"""md
# Training experiment

Compare **two configurations** using the same data.

- Keep the random seed fixed.
- Record the error for each universe.
"""

predictions = [scale * value for value in [1, 2, 3]]
print(predictions)  # Ordinary comments stay with the code.
```

Open the preview using **Limulus: Preview Python Markdown**, the Python editor's
preview icon, or the `.py` file's context menu in Explorer. In the graph, select a
node and click **Preview source**.

The preview displays a continuous document with formatted Markdown and
syntax-highlighted Python. It follows unsaved edits, Undo/Redo, saves, and external
document updates. Source line numbers and section links help you return to the
corresponding code. Previewing a file does not execute it.

### Markdown block syntax

- Use `"""md` or `'''md` on an opening line, and the matching triple quotes on a
  closing line.
- Write Markdown directly between the delimiters. No comment prefix is needed.
- Use a raw string, such as `r"""md`, when the content contains backslashes.
- Indented blocks remove their surrounding Python indentation while preserving
  Markdown list indentation and code fences.
- Regular comments, assigned strings, function arguments, f-strings, and strings
  without the `md` header remain code in the preview.
- An unfinished block stays code until its closing quotes are typed.

Markdown blocks are ordinary standalone Python string literals. A block at the
beginning of a module, function, or class becomes its docstring. They do not
introduce executable notebook cells or additional project files.

The preview supports headings, emphasis, lists, tables, blockquotes, fenced code,
links, and images. Relative images and file links resolve within the Python file's
folder. HTTPS images and HTTP(S)/mailto links are supported. Raw HTML is displayed
as text, and command/script links are not executed.

Try [examples/markdown.py](examples/markdown.py) for a complete example.

## Code output previews

Run nodes from the graph to see results in its **Execution output** panel and in
**Preview source**. The source preview shows retained output below the code, with
a selector for the project, node, and universe. Prints link back to their source
line when available. Opening a preview never executes code.

```python
import pandas as pd
import matplotlib.pyplot as plt

print("Experiment results")
results = pd.DataFrame({"epoch": [1, 2, 3], "loss": [0.8, 0.4, 0.2]})
display(results)

plt.plot(results["epoch"], results["loss"])
plt.xlabel("Epoch")
plt.ylabel("Loss")
plt.show()
```

- **Text:** `print(...)`, stderr, and Python tracebacks appear as text.
- **Tables:** `display(df)` and `display(series)` render pandas data with row and
  column labels. Previews show up to 100 rows and 30 columns, with individual
  values limited to 2,000 characters. The original data is unchanged.
- **Plots:** `plt.show()` and `display(fig)` capture Matplotlib figures as PNGs.
  Open pyplot figures are also captured when a node finishes, then closed.
  Plots use a headless backend; interactive plot windows are unsupported.
- **Final expressions:** a final expression such as `results.head()` displays
  automatically. Markdown blocks and module docstrings produce no output.
  Use `display(...)` for results earlier in the file.

Add pandas and Matplotlib to the project requirements to use their previews. Other objects display a shortened
Python representation. Arbitrary HTML representations are not rendered.

Source previews retain the latest results per node and universe for the current
VS Code session, up to a shared 2,000-event / 20 MiB limit. Editing source marks
its previous results as outdated. Rerunning a node replaces its results;
restarting a universe clears its previous results. Resetting runtimes, closing
the graph, or restarting the server clears the associated source-preview output.
Results are not written into Python or graph files. Individual plot previews are
limited to 4 MiB and a maximum dimension of 1,800 pixels.

Try [examples/outputs.py](examples/outputs.py) as a node's source file.

## Settings and commands

| Setting | Default | Purpose |
| --- | --- | --- |
| `limulus.autoStart` | `true` | Starts the backend when a trusted workspace contains `.lmg` files. |
| `limulus.pythonPath` | `python3` | Base Python for creating project environments and preview tokenization. |
| `limulus.serverPath` | empty | Optional path to a compatible backend binary; otherwise uses the bundled binary. |

Apply execution interpreter or backend changes with **Limulus: Restart Server**.
Preview tokenization picks up interpreter changes automatically.

**Limulus: Show Server Output** opens backend startup diagnostics. If execution
cannot start, check this output and confirm that the configured Python executable
is available.

The extension runs in the workspace extension host and communicates with its
backend over an authenticated loopback connection. Windows runtimes and
browser-only VS Code without a remote extension host are unsupported.

## Development

This extension is part of the npm workspace two directories above. From `clients`:

```sh
npm ci
npm run build:extension
npm test
npm run package:extension
```

The shared React editor is in `packages/editor-ui`; graph rules and output handling
are in `packages/editor-core`. Filesystem, environment and runtime management live
in `packages/node-host`. Files under `src/` retain the VS Code document, command,
preview and lifecycle integration. Small compatibility exports keep the native
host tests exercising the shared implementations.

Open this directory in VS Code and press F5 to build and launch the extension
against the sibling server's universe example. See the [workspace guide](../../README.md)
for architecture, standalone web usage, build prerequisites and packaging.
