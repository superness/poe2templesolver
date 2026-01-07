# POE2 Temple Solver

An optimizer for Path of Exile 2 Vaal Temple layouts using constraint programming (OR-Tools CP-SAT).

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.10+

### Run Locally

**1. Start the Python solver backend:**

```bash
cd solver-python
pip install -r requirements.txt
python server.py
```

Server runs at `http://localhost:5000`

**2. Start the frontend:**

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

## Usage

1. **Import a temple** - Paste a Sulozor URL (`https://sulozor.github.io/poe2-temple/?t=...`) or use one of the test temples
2. **Configure constraints** - Set min Spymasters, Corruption Chambers, penalties, etc.
3. **Configure chains** (optional) - Use presets or create custom chain configurations
4. **Click Solve** - The solver finds an optimal layout
5. **Export** - Open result in Sulozor or copy a shareable link

## Features

- Constraint-based optimization using OR-Tools CP-SAT
- Chain configurations to group room types into branches
- Snake mode to encourage linear layouts
- Junction and empty cell penalties
- Import/export with Sulozor compatibility
- Shareable URLs with `?t=` parameter

## Chain Presets

- **Spymaster Focus**: 10-12 Spymasters + Corruption chain
- **Golem/Corruption**: Spymaster chain + Golem/Corruption chain (starts at Thaumaturge) + Generator
- **Balanced**: 3 chains with mixed room types

## Production Deployment

See the `deploy/` folder for nginx, systemd, and gunicorn configs for hosting on a VPS.

```bash
# On Ubuntu server:
sudo bash deploy/setup-server.sh
```

## License

MIT
