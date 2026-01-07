#!/usr/bin/env python3
"""
CNN model to predict temple room placements.
Used to generate warm-start hints for CP-SAT solver.
"""

import json
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from pathlib import Path

# Grid and room constants
GRID_SIZE = 11
FOYER_POS = (1, 1)

ROOM_TYPES = [
    'EMPTY', 'PATH',  # 0, 1
    'SPYMASTER', 'GARRISON', 'LEGION_BARRACKS', 'COMMANDER', 'ARMOURY',
    'CORRUPTION_CHAMBER', 'THAUMATURGE', 'SACRIFICIAL_CHAMBER', 'ALCHEMY_LAB',
    'GOLEM_WORKS', 'SMITHY', 'GENERATOR', 'FLESH_SURGEON', 'SYNTHFLESH'
]
ROOM_TO_IDX = {r: i for i, r in enumerate(ROOM_TYPES)}
NUM_ROOM_TYPES = len(ROOM_TYPES)


class TempleDataset(Dataset):
    """Dataset of solved temples."""

    def __init__(self, json_path):
        with open(json_path) as f:
            self.samples = json.load(f)

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        sample = self.samples[idx]

        # Build input features: 11x11 x num_features
        # Features per cell:
        # - one-hot existing room type (or 0s if empty)
        # - is_architect (1/0)
        # - is_foyer (1/0)
        # - distance to foyer (normalized)
        # - distance to architect (normalized)

        architect = tuple(sample['input']['architect'])
        existing_rooms = {(r['x'], r['y']): r for r in sample['input']['existing_rooms']}

        num_features = NUM_ROOM_TYPES + 4  # room one-hot + architect + foyer + 2 distances
        features = np.zeros((num_features, GRID_SIZE, GRID_SIZE), dtype=np.float32)

        for x in range(1, GRID_SIZE + 1):
            for y in range(1, GRID_SIZE + 1):
                i, j = x - 1, y - 1  # 0-indexed

                # Existing room one-hot
                if (x, y) in existing_rooms:
                    room = existing_rooms[(x, y)]
                    room_idx = ROOM_TO_IDX.get(room['type'], 0)
                    features[room_idx, j, i] = 1.0

                # Is architect
                if (x, y) == architect:
                    features[NUM_ROOM_TYPES, j, i] = 1.0

                # Is foyer
                if (x, y) == FOYER_POS:
                    features[NUM_ROOM_TYPES + 1, j, i] = 1.0

                # Distance to foyer (normalized by grid size)
                dist_foyer = abs(x - FOYER_POS[0]) + abs(y - FOYER_POS[1])
                features[NUM_ROOM_TYPES + 2, j, i] = dist_foyer / (2 * GRID_SIZE)

                # Distance to architect
                dist_arch = abs(x - architect[0]) + abs(y - architect[1])
                features[NUM_ROOM_TYPES + 3, j, i] = dist_arch / (2 * GRID_SIZE)

        # Build target: 11x11 room type indices
        target = np.zeros((GRID_SIZE, GRID_SIZE), dtype=np.int64)

        # Mark solution rooms
        for room in sample['output']['rooms']:
            x, y = room['x'], room['y']
            room_idx = ROOM_TO_IDX.get(room['type'], 0)
            target[y - 1, x - 1] = room_idx

        # Mark solution paths
        for path in sample['output']['paths']:
            x, y = path['x'], path['y']
            target[y - 1, x - 1] = ROOM_TO_IDX['PATH']

        return torch.tensor(features), torch.tensor(target)


class TempleCNN(nn.Module):
    """CNN to predict room placements."""

    def __init__(self, num_features=NUM_ROOM_TYPES + 4):
        super().__init__()

        self.conv1 = nn.Conv2d(num_features, 64, kernel_size=3, padding=1)
        self.conv2 = nn.Conv2d(64, 128, kernel_size=3, padding=1)
        self.conv3 = nn.Conv2d(128, 128, kernel_size=3, padding=1)
        self.conv4 = nn.Conv2d(128, 64, kernel_size=3, padding=1)
        self.conv_out = nn.Conv2d(64, NUM_ROOM_TYPES, kernel_size=1)

        self.relu = nn.ReLU()
        self.dropout = nn.Dropout2d(0.1)

    def forward(self, x):
        # x: (batch, features, 11, 11)
        x = self.relu(self.conv1(x))
        x = self.dropout(x)
        x = self.relu(self.conv2(x))
        x = self.dropout(x)
        x = self.relu(self.conv3(x))
        x = self.dropout(x)
        x = self.relu(self.conv4(x))
        x = self.conv_out(x)
        # output: (batch, num_room_types, 11, 11)
        return x


def train_model(data_path, model_path='temple_model.pt', epochs=50, batch_size=16, lr=0.001):
    """Train the model on temple data."""
    print(f"Loading data from {data_path}...")
    dataset = TempleDataset(data_path)
    print(f"Loaded {len(dataset)} samples")

    # Split train/val
    train_size = int(0.9 * len(dataset))
    val_size = len(dataset) - train_size
    train_dataset, val_dataset = torch.utils.data.random_split(dataset, [train_size, val_size])

    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=batch_size)

    # Model
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"Using device: {device}")

    model = TempleCNN().to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=lr)

    best_val_loss = float('inf')

    for epoch in range(epochs):
        # Train
        model.train()
        train_loss = 0
        for features, targets in train_loader:
            features, targets = features.to(device), targets.to(device)

            optimizer.zero_grad()
            outputs = model(features)
            loss = criterion(outputs, targets)
            loss.backward()
            optimizer.step()

            train_loss += loss.item()

        train_loss /= len(train_loader)

        # Validate
        model.eval()
        val_loss = 0
        correct = 0
        total = 0

        with torch.no_grad():
            for features, targets in val_loader:
                features, targets = features.to(device), targets.to(device)
                outputs = model(features)
                loss = criterion(outputs, targets)
                val_loss += loss.item()

                _, predicted = outputs.max(1)
                correct += (predicted == targets).sum().item()
                total += targets.numel()

        val_loss /= len(val_loader)
        accuracy = correct / total

        print(f"Epoch {epoch+1}/{epochs}: train_loss={train_loss:.4f}, val_loss={val_loss:.4f}, accuracy={accuracy:.2%}")

        # Save best model
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save(model.state_dict(), model_path)
            print(f"  Saved best model to {model_path}")

    print(f"\nTraining complete. Best val_loss: {best_val_loss:.4f}")
    return model


def predict_hints(model_path, architect, existing_rooms=None):
    """Use trained model to predict room placements."""
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

    model = TempleCNN()
    model.load_state_dict(torch.load(model_path, map_location=device))
    model.to(device)
    model.eval()

    # Build features
    existing = {(r['x'], r['y']): r for r in (existing_rooms or [])}
    num_features = NUM_ROOM_TYPES + 4
    features = np.zeros((1, num_features, GRID_SIZE, GRID_SIZE), dtype=np.float32)

    for x in range(1, GRID_SIZE + 1):
        for y in range(1, GRID_SIZE + 1):
            i, j = x - 1, y - 1

            if (x, y) in existing:
                room = existing[(x, y)]
                room_idx = ROOM_TO_IDX.get(room['type'], 0)
                features[0, room_idx, j, i] = 1.0

            if (x, y) == tuple(architect):
                features[0, NUM_ROOM_TYPES, j, i] = 1.0

            if (x, y) == FOYER_POS:
                features[0, NUM_ROOM_TYPES + 1, j, i] = 1.0

            dist_foyer = abs(x - FOYER_POS[0]) + abs(y - FOYER_POS[1])
            features[0, NUM_ROOM_TYPES + 2, j, i] = dist_foyer / (2 * GRID_SIZE)

            dist_arch = abs(x - architect[0]) + abs(y - architect[1])
            features[0, NUM_ROOM_TYPES + 3, j, i] = dist_arch / (2 * GRID_SIZE)

    # Predict
    with torch.no_grad():
        features_t = torch.tensor(features).to(device)
        outputs = model(features_t)
        probs = torch.softmax(outputs, dim=1)
        predictions = outputs.argmax(dim=1)[0].cpu().numpy()
        confidence = probs.max(dim=1)[0][0].cpu().numpy()

    # Convert to hints
    hints = []
    for x in range(1, GRID_SIZE + 1):
        for y in range(1, GRID_SIZE + 1):
            i, j = x - 1, y - 1
            pred_type = ROOM_TYPES[predictions[j, i]]
            conf = confidence[j, i]

            if pred_type not in ('EMPTY', 'PATH') and conf > 0.5:
                hints.append({
                    'x': x, 'y': y,
                    'type': pred_type,
                    'confidence': float(conf)
                })

    return hints


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument('--train', type=str, help='Train model on data file')
    parser.add_argument('--model', type=str, default='temple_model.pt', help='Model file')
    parser.add_argument('--epochs', type=int, default=50)
    parser.add_argument('--test', action='store_true', help='Test prediction')
    args = parser.parse_args()

    if args.train:
        train_model(args.train, args.model, epochs=args.epochs)
    elif args.test:
        hints = predict_hints(args.model, architect=[6, 6])
        print(f"Predicted {len(hints)} room hints:")
        for h in hints[:10]:
            print(f"  ({h['x']}, {h['y']}): {h['type']} ({h['confidence']:.0%})")
