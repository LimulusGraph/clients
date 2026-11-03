<p align="center">
  <img src="apps/vscode-extension/logo.jpg" alt="Limulus logo" width="200" />
</p>

<h1 align="center">Limulus</h1>

<p align="center">
  <strong>One experiment. Many universes.</strong><br />
  A visual Python workspace, in your browser or inside VS Code.
</p>

<p align="center">
  <a href="#choose-your-workspace">Choose your workspace</a> ·
  <a href="#get-started">Get started</a> ·
  <a href="#build-your-first-experiment">Your first experiment</a> ·
  <a href="#how-universes-work">Universes</a> ·
  <a href="#development">Development</a>
</p>

---

Branch a data pipeline, compare two models, and follow both ideas to their
results. Limulus connects ordinary Python files into a visual graph. Every
complete path becomes an independent experiment—a **universe** with its own
Python state.

| Build visually | Explore in parallel | See your results |
| --- | --- | --- |
| Connect reusable Python steps, branch into alternatives, and keep your source in `.py` files. | Run independent universes concurrently, or rerun a single node with its live variables intact. | Inspect text, pandas tables, and Matplotlib plots, filtered by universe or node. |

Your `.lmg` graph and Python files stay on your machine, ready for your usual
editor and version control.

## Choose your workspace

The same graph editor powers both applications. Choose the home that fits your
workflow:

| In your browser | Inside VS Code |
| --- | --- |
| A standalone local app with project tabs and a built-in Python source editor. | A native graph editor alongside your Python files. |
| Open and save local projects, edit dependencies, and run experiments from one window. | Use native saving, Undo/Redo, commands, and live Markdown source previews. |
| Start from a terminal and open the local URL. | Install the extension and open a `.lmg` file. |

Both include the execution backend and manage project-local Python environments.
The applications support **macOS and Linux**. Python 3 with `venv` support is
required; the browser application also requires **Node.js 22.12 or later**.

## Get started

### Browser

Extract a `limulus-web-<platform>-<arch>.tar.gz` package for your machine, then
start it from the extracted folder:

```sh
cd limulus-web
npm start
```

Open **http://127.0.0.1:3000**. Keep the terminal open while you work; press
**Ctrl+C** to stop the app and its Python runtimes. The packaged application
requires no `npm install`, Go compiler, or separate server.

To choose another port or Python interpreter, set `PORT` or `LIMULUS_PYTHON` when
starting the app—for example, `PORT=3002 npm start`.

### VS Code

Install the `.vsix` package for your machine using
**Extensions → … → Install from VSIX…**, then open a trusted project folder.
Run **Limulus: New Graph** from the Command Palette, or open an existing `.lmg`
file to begin.

The extension requires **VS Code 1.95 or later**. See the
[extension guide](apps/vscode-extension/README.md) for source previews,
settings, and the full command reference.

Building from source? Follow the short [development guide](#development) below.

## Build your first experiment

1. **Create a graph.** In the browser, choose **New**, then **Save As…** to keep
   the graph in your project folder. In VS Code, use **Limulus: New Graph**.
2. **Add your steps.** Click **＋ Node**, then click a node to open its Python
   source. Connect nodes by dragging between their handles.
3. **Add dependencies.** In the browser's **Commands** menu, choose
   **Edit Dependencies**. In VS Code, run **Limulus: View Dependencies**.
   List the packages your experiment uses in `requirements.txt`.
4. **Run and inspect.** Choose **Run all**. Limulus prepares the project's
   `.venv`, installs requirements when needed, and streams results into the
   output panel.

Double-click a connection to enable or disable it. Rename or remove nodes with
the graph toolbar; removing a node retains its Python file.

In the browser, **Open…** accepts a local `.lmg` path. New graphs begin in temporary
folders, so use **Save As…** to keep them. Save As copies source files and
requirements alongside the graph and refuses to overwrite existing destination
files. Source drafts are saved before execution; closing the source pane keeps
the draft available in its project tab.

## How universes work

Each complete root-to-leaf path through enabled connections is a separate
universe. A standalone node is a universe too.

```text
                  ┌─ Model A ─┐
Load → Prepare ────┤           ├── Evaluate
                  └─ Model B ─┘

Universe 1: Load → Prepare → Model A → Evaluate
Universe 2: Load → Prepare → Model B → Evaluate
```

Nodes within a universe share live Python variables, imports, functions, and
objects. Different universes have independent Python processes. In this example,
Evaluate sees the model from its own path; the converging connections do not
merge the two runtimes.

| Control | What it does |
| --- | --- |
| **Run all** | Starts fresh runtimes and executes every complete universe. |
| **Run through node** | Restarts matching universes and executes through the selected node. |
| **Run cell** | Executes the selected node in matching live runtimes; preceding nodes must already have succeeded. |
| **Stop** | Cancels the active execution. |
| **Reset runtimes** | Stops the project's Python runtimes and releases their state. |

A failed node stops its universe; other universes continue. Python memory is
separate, but files and other machine resources are shared. Shared steps execute
once per universe, including file writes. Save graph and source files to keep
your work—live Python state is not saved across resets or shutdown.

## Inspect your output

Use ordinary Python to produce results:

```python
import pandas as pd
import matplotlib.pyplot as plt

results = pd.DataFrame({"epoch": [1, 2, 3], "loss": [0.8, 0.4, 0.2]})
print("Training results")
display(results)

plt.plot(results["epoch"], results["loss"])
plt.xlabel("Epoch")
plt.ylabel("Loss")
plt.show()
```

Add `pandas` and `matplotlib` to your project requirements to try this example.
The output panel displays text, tables, and plots, with filters for individual
universes and nodes. It retains up to 2,000 events or 20 MiB from the current run.

Inside VS Code, **Preview source** also shows live Markdown embedded in Python
files alongside retained execution output. Explore the
[Markdown example](apps/vscode-extension/examples/markdown.py) and
[output example](apps/vscode-extension/examples/outputs.py).

## Development

Check out this repository beside the [server](https://github.com/LimulusGraph/server)
repository as `../server`. Source builds require Node.js 22.12+, npm, Python 3,
and Go compatible with the server's `go.mod`. From this repository's root:

```sh
npm ci
npm run build          # Build both applications and their bundled backends
npm start              # Run the browser app at http://127.0.0.1:3000
```

Use `npm run dev` for web development with live reload, or open
`apps/vscode-extension` in VS Code and press **F5** to debug the extension.
Run `npm test` for the test suite; live runtime tests require localhost binding.

```sh
npm run package:web        # Standalone archive in artifacts/
npm run package:extension  # VSIX in apps/vscode-extension/
```

The npm workspace contains `apps/web` and `apps/vscode-extension`. Shared
`@limulus` packages in `packages/` provide graph and execution logic (`editor-core`),
the React editor (`editor-ui`), and filesystem/Python runtime services (`node-host`).
Both hosts use these packages; application builds stay inside this repository.
