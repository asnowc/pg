export class LinkList<T extends {} = {}> {
  head?: Link<T>;
  private tail?: Link<T>;
  push(item: Link<T>) {
    if (this.tail) {
      this.tail.next = item;
      this.tail = item;
    } else {
      this.head = item;
      this.tail = item;
    }
  }
  shift(): Link<T> | undefined {
    if (!this.head) return undefined;
    const item = this.head;
    this.head = item.next;

    if (!item.next) this.tail = undefined;
    return item;
  }
  clear() {
    this.head = undefined;
    this.tail = undefined;
  }
}

export class CountLinkList<T extends {} = {}> {
  head?: Link<T>;
  private tail?: Link<T>;
  length = 0;
  push(item: T): void {
    if (this.tail) this.tail.next = item;
    else this.head = item;
    this.tail = item;
    this.length++;
  }
  shift() {
    this.head = this.head!.next;
    if (!this.head) this.tail = undefined;
    this.length--;
  }
  clear() {
    this.head = undefined;
    this.tail = undefined;
    this.length = 0;
  }
}

export type Link<T extends {} = {}> = T & {
  next?: Link<T>;
};
export function* eachLink<T extends {}>(node?: Link<T>): Generator<T, void, unknown> {
  let current: Link<T> | undefined = node;
  while (current) {
    yield current;
    current = current.next;
  }
}
