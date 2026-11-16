# Local neural-agent training

AI Training Lab now has two distinct paths:

- **Heuristic tuning** evolves the existing hand-authored weights in the browser.
- **Neural training** runs real five-player games in the browser engine, then applies a local PyTorch PPO update to a residual MLP policy with 96 public features and 256/128 hidden layers, large enough to learn cross-feature interactions while remaining inexpensive for synchronous browser inference. The model is saved in browser local storage and runs in ordinary games without Python; Python/PyTorch is only required to train or continue training it.

The neural policy sees the same masked `PlayerView` and legal options as any other agent. The training process receives encoded decision features and final rewards, never a `GameState`, another seat's hand, or face-down library contents. Browser inference and Python training share the fixed `vtes-mlp-v1` feature and weight layout in `src/ai/ml-agent.ts` and `scripts/train_ml.py`.

## Python / CUDA setup

Create a local Python environment and install a CUDA-enabled PyTorch wheel compatible with the installed NVIDIA driver. Use the command from the official PyTorch install selector for **Windows / Pip / CUDA** (or Linux, as appropriate); do not install a CPU-only wheel if you want the RTX 3070 to train the network.

Example Windows PowerShell flow (replace the wheel index with the one selected for your driver/PyTorch version if needed):

```powershell
py -3 -m venv .venv-ml
.\.venv-ml\Scripts\python.exe -m pip install --upgrade pip
.\.venv-ml\Scripts\python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cu128
$env:VTES_PYTHON = "$PWD\.venv-ml\Scripts\python.exe"
.\Play VTES.bat
```

Example Linux flow:

```bash
python3 -m venv .venv-ml
.venv-ml/bin/python -m pip install --upgrade pip
.venv-ml/bin/python -m pip install torch --index-url https://download.pytorch.org/whl/cu128
export VTES_PYTHON="$PWD/.venv-ml/bin/python"
npm run play
```

If the selected official PyTorch command uses a different CUDA wheel index, use that instead of `cu128`. Confirm CUDA before opening the app:

```bash
python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"
```

When `VTES_PYTHON` is unset, the dev server tries `python` on Windows and `python3` elsewhere. If CUDA PyTorch is not installed, training can still run on CPU and the panel reports the actual backend. A normal production/static build has no Python endpoint. Train and play from the same local Vite app: the saved model is stored in that browser origin's local storage and can be selected under **Settings → Bots**. Local storage does not move automatically between `localhost`, Arena preview, and a published site; use the same origin where you trained.

## Choosing the candidate's deck

In **AI Training Lab → Candidate deck for training and comparison**, choose the default bundled snapshots, a deck saved under **My decks**, or paste a full VDB/Amaranth/ARDB-style list (counts and names). The same selection applies to heuristic tuning, neural episodes and bot comparisons. The pasted list is held on this page, not automatically saved. Import errors, unrecognized cards and illegal deck sizes/groups stop the run and are reported; no cards are intentionally dropped. Full decks only: at least 12 crypt cards and 60–90 library cards. For safety, pasted lists are capped at 100,000 characters and 2,000 listed copies. Known crypt abilities marked unimplemented are reported, and other card effects may also be incomplete (see the card audit).

A selected deck is validated and captured at the start of a run, then assigned to the candidate at each rotated seat. The other four seats use distinct Fifth Edition precons, chosen to reduce crypt overlap; contests remain possible. All five seats start with full dealt decks and 30 pool. The default retains the older mid-game snapshots, so the two setups are not directly comparable. Comparison resume retains the original captured deck even if the selector later changes; a page reload loses the in-memory run. Matching uses the same seed, candidate seat, deck and opponents for both bots within each pair. Ollama comparison does not train or alter the model. Actual outcomes remain dependent on the engine's implemented rules and cards.

## Training behavior

Each update round uses seeded five-seat games. The candidate rotates seats against four changing styles drawn from Balanced, Bruiser, Stalker, Turtle, Politician, and Builder. A round ends with a PPO update; successful round models are saved immediately. UI scores include candidate mean VP, opponents' mean VP, wins, ousts, and the chosen backend. Cancellation takes effect at a game/round boundary, not halfway through engine resolution.

## Heuristic tournament workers

The upper **Tournament setup** tunes heuristic weights; it is separate from the neural/PyTorch section. Independent games of a generation run in a bounded pool of browser Web Workers, on the computer running the browser, not the server or GPU. Choose **Parallel game workers** (1–32); the initial value is the browser-reported logical CPU count capped at 16. The browser may report fewer CPUs than the machine has, and increasing the count costs memory and can make other applications less responsive. Speedup depends on the CPU, memory, browser and game workload; 16 workers do not guarantee a 16× speedup. In environments without Web Workers, the serial executor is used and the UI says so. A worker failure stops the run instead of silently scoring a missing game.

Every game has the same seed, seat rotation and opponent assignment as the serial tournament. Results are aggregated in task order; the next population is generated only after all games in a generation finish, so a completed run with the same configuration and seed produces the same report regardless of worker count. Cancellation stops scheduling new games and waits for games already running; partially evaluated candidates can have incomparable scores, and only fully evaluated candidates contribute to generation trends. Training is in memory and is not resumed after a page reload. Saving a candidate is a separate action. The progress display reports total completed games as well as the candidate most recently completed, which may jump around as workers finish.

The requested total is variants × generations × games per variant. For example, 100 × 200 × 500 is **10,000,000 games**, so even parallel training can take a very long time; start smaller and monitor throughput before committing to a large run.
