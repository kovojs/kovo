// Tutorial step 04 (chapter 4): the in-memory database gains transactions and
// named-table writes so commit and rollback behavior is real, not simulated.

export interface ShopProduct {
  id: string;
  name: string;
  stock: number;
  unitPrice: number;
}

export interface CartItem {
  productId: string;
  qty: number;
  unitPrice: number;
}

// snippet:db
export interface ShopDb {
  cartItems: CartItem[];
  products: Map<string, ShopProduct>;
  transaction<Result>(run: (db: ShopDb) => Promise<Result>): Promise<Result>;
  write(table: 'cart_items' | 'products', value: unknown): void;
}
// /snippet

export interface ShopRequest {
  db: ShopDb;
  session?: { id?: string } | null;
}

export function createShopDb(): ShopDb {
  const db: ShopDb = {
    cartItems: [],
    products: new Map([
      ['p1', { id: 'p1', name: 'Pour-over kettle', stock: 5, unitPrice: 1499 }],
      ['p2', { id: 'p2', name: 'Ceramic dripper', stock: 2, unitPrice: 2599 }],
      ['p3', { id: 'p3', name: 'Paper filters', stock: 8, unitPrice: 399 }],
    ]),
    // snippet:transaction
    async transaction(run) {
      const draft = cloneShopDb(db);
      const result = await run(draft);

      // Commit: the draft becomes the database. A thrown error (fail()
      // rolls back this way) discards the draft instead.
      db.cartItems = draft.cartItems;
      db.products = draft.products;

      return result;
    },
    // /snippet
    write(table, value) {
      if (table === 'cart_items') {
        db.cartItems.push(value as CartItem);
      }
      if (table === 'products') {
        const product = value as ShopProduct;
        db.products.set(product.id, product);
      }
    },
  };
  return db;
}

function cloneShopDb(source: ShopDb): ShopDb {
  const clone = createShopDb();

  clone.cartItems = source.cartItems.map((item) => ({ ...item }));
  clone.products = new Map(
    [...source.products.entries()].map(([key, value]) => [key, { ...value }]),
  );

  return clone;
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
