/**
 * Search tree node for A* algorithm
 */

import { PlacementAction } from '../domain/types.js';
import { TempleState } from '../state/temple-state.js';

export interface SearchNode {
  state: TempleState;
  parent: SearchNode | null;
  action: PlacementAction | null;
  depth: number;
  cost: number;      // g(n) - cost from start
  heuristic: number; // h(n) - estimated cost to goal
  priority: number;  // f(n) = g(n) + h(n)
}

/**
 * Create a search node
 */
export function createSearchNode(
  state: TempleState,
  parent: SearchNode | null,
  action: PlacementAction | null,
  cost: number,
  heuristic: number
): SearchNode {
  return {
    state,
    parent,
    action,
    depth: parent ? parent.depth + 1 : 0,
    cost,
    heuristic,
    priority: cost + heuristic,
  };
}

/**
 * Extract the path of actions from root to this node
 */
export function extractActionPath(node: SearchNode): PlacementAction[] {
  const actions: PlacementAction[] = [];
  let current: SearchNode | null = node;

  while (current !== null) {
    if (current.action !== null) {
      actions.unshift(current.action);
    }
    current = current.parent;
  }

  return actions;
}

/**
 * Priority queue for A* search
 */
export class PriorityQueue<T extends { priority: number }> {
  private items: T[] = [];

  push(item: T): void {
    // Binary heap insert
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;

    const result = this.items[0];
    const last = this.items.pop();

    if (this.items.length > 0 && last !== undefined) {
      this.items[0] = last;
      this.bubbleDown(0);
    }

    return result;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  size(): number {
    return this.items.length;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.items[parentIndex].priority <= this.items[index].priority) {
        break;
      }
      [this.items[parentIndex], this.items[index]] = [this.items[index], this.items[parentIndex]];
      index = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    while (true) {
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;
      let smallest = index;

      if (leftChild < this.items.length &&
          this.items[leftChild].priority < this.items[smallest].priority) {
        smallest = leftChild;
      }

      if (rightChild < this.items.length &&
          this.items[rightChild].priority < this.items[smallest].priority) {
        smallest = rightChild;
      }

      if (smallest === index) break;

      [this.items[smallest], this.items[index]] = [this.items[index], this.items[smallest]];
      index = smallest;
    }
  }
}
