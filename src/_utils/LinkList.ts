export class LinkList<T extends {} = {}> {
  head?: Link<T>;
  private tail?: Link<T>;
  enqueue(item: Link<T>) {
    if (this.tail) {
      item.prev = this.tail;
      this.tail.next = item;
      this.tail = item;
    } else {
      this.head = item;
      this.tail = item;
    }
  }
  dequeue(): Link<T> | undefined {
    if (!this.head) return undefined;
    const item = this.head;
    this.head = item.next;

    if (this.head) this.head.prev = undefined;
    if (!item.next) this.tail = undefined;
    return item;
  }
  *[Symbol.iterator](): Iterator<Readonly<Link<{}> & T>> {
    let current = this.head;
    while (current) {
      yield current;
      current = current.next;
    }
  }
  setLink(item: Link<T>) {
    this.head = item;
  }
  clear() {
    this.head = undefined;
    this.tail = undefined;
  }
  getLength() {
    let count = 0;
    let current = this.head;
    while (current) {
      count++;
      current = current.next;
    }
    return count;
  }
}

type Link<T extends {} = {}> = T & {
  prev?: Link<T>;
  next?: Link<T>;
};
