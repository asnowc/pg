export class LinkList<T extends {} = {}> {
  head?: Link<T>;
  private tail?: Link<T>;
  push(item: Link<T>): void {
    if (this.tail) this.tail.next = item;
    else this.head = item;
    this.tail = item;
    if (item.next !== undefined) throw new Error("Item already has a next link");
  }
  shift() {
    const head = this.head!;
    this.head = head.next;
    if (!this.head) this.tail = undefined;
    head.next = undefined;
  }
  clear() {
    this.head = undefined;
    this.tail = undefined;
  }
  remove(target: Link<T>, prev: Link<T> | undefined): void {
    if (target === this.head) {
      this.shift();
      return;
    }

    if (prev) {
      prev.next = target.next;
      if (target === this.tail) this.tail = prev;
    }
    target.next = undefined;
  }
}

export class CountLinkList<T extends {} = {}> extends LinkList<T> {
  length = 0;
  override push(item: Link<T>): void {
    super.push(item);
    this.length++;
  }
  override shift() {
    super.shift();
    this.length--;
  }
  override clear() {
    super.clear();
    this.length = 0;
  }
  override remove(target: Link<T>, prev: Link<T> | undefined): void {
    super.remove(target, prev);
    this.length--;
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
