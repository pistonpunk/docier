export type NodeId = number & { readonly __nodeId: true };

export const asNodeId = (value: number): NodeId => value as NodeId;

export class NodeIdAllocator {
  private counter = 0;

  next(): NodeId {
    this.counter += 1;
    return asNodeId(this.counter);
  }

  get issued(): number {
    return this.counter;
  }

  reserve(id: NodeId): void {
    if (id > this.counter) this.counter = id;
  }
}
