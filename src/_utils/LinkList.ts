export class LinkList<T extends {} = {}> {
  head?: Link<T>;
  private tail?: Link<T>;
  private total: number = 0;
  enqueue(item: Link<T>) {
    if (!this.head) {
      this.head = item;
      this.tail = item;
    } else {
      item.prev = this.tail;
      if (this.tail) this.tail.next = item;
      this.tail = item;
    }
    this.total++;
  }
  dequeue(): Link<T> | undefined {
    if (!this.head) return undefined;
    const item = this.head;
    this.head = item.next;

    if (this.head) this.head.prev = undefined;
    if (item === this.tail) this.tail = undefined;
    this.total--;
    return item;
  }
  *[Symbol.iterator](): Iterator<Readonly<Link<{}> & T>> {
    let current = this.head;
    while (current) {
      yield current;
      current = current.next;
    }
  }
  clear() {
    this.head = undefined;
    this.tail = undefined;
    this.total = 0;
  }
}

export type Link<T extends {} = {}> = T & {
  prev?: Link<T>;
  next?: Link<T>;
};
