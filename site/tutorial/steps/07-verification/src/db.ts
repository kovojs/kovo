import type { TaskSchedulingRequest } from '@kovojs/server/tasks';

// Tutorial step 07 (chapter 7): the database gains an orders table and the
// request shell gains a typed session user, so the cart/add write set —
// cart, product, order — matches the reference commerce app's.

export type ShopProduct = {
  id: string;
  name: string;
  stock: number;
  unitPrice: number;
};

export type CartItem = {
  productId: string;
  qty: number;
  unitPrice: number;
  userId: string;
};

export type ShopOrder = {
  id: string;
  productId: string;
  qty: number;
  total: number;
  userId: string;
};

export interface ShopReadModel {
  readonly cartItems: readonly CartItem[];
  readonly orders: readonly ShopOrder[];
  readonly products: ReadonlyMap<string, ShopProduct>;
}

export interface ShopDb {
  cartItems: CartItem[];
  orders: ShopOrder[];
  products: Map<string, ShopProduct>;
  query: {
    snapshot(): ShopReadModel;
  };
  transaction<Result>(run: (db: ShopDb) => Promise<Result>): Promise<Result>;
  write(table: 'cart_items' | 'orders' | 'products', value: unknown): void;
}

// snippet:request-shell
export interface ShopRequest extends Request, TaskSchedulingRequest {
  db: ShopDb;
  env: Readonly<Record<never, never>>;
  session: { id?: string; user?: { id: string } | null } | null;
  tutorialDbToken: object;
}
// /snippet

const tutorialShopDbs = new WeakMap<object, ShopDb>();

export function createShopRequest(
  db = createShopDb(),
  session: Exclude<ShopRequest['session'], undefined> = { id: 's1', user: { id: 'u1' } },
): ShopRequest {
  const tutorialDbToken = {};
  tutorialShopDbs.set(tutorialDbToken, db);
  return Object.assign(new Request('https://tutorial.kovo.dev/'), {
    async cancel() {
      return false;
    },
    db,
    env: Object.freeze({}),
    schedule() {
      return Promise.reject(new Error('tutorial request has no durable-task scheduler'));
    },
    session,
    tutorialDbToken,
  });
}

export function tutorialShopDb(request: Pick<ShopRequest, 'tutorialDbToken'>): ShopDb {
  const db = tutorialShopDbs.get(request.tutorialDbToken);
  if (!db) throw new Error('tutorial request is not bound to an in-memory shop database');
  return db;
}

export function createShopDb(): ShopDb {
  const db: ShopDb = {
    cartItems: [],
    orders: [],
    products: new Map([
      ['p1', { id: 'p1', name: 'Pour-over kettle', stock: 5, unitPrice: 1499 }],
      ['p2', { id: 'p2', name: 'Ceramic dripper', stock: 2, unitPrice: 2599 }],
      ['p3', { id: 'p3', name: 'Paper filters', stock: 8, unitPrice: 399 }],
    ]),
    query: {
      snapshot() {
        return { cartItems: db.cartItems, orders: db.orders, products: db.products };
      },
    },
    async transaction(run) {
      const draft = cloneShopDb(db);
      const result = await run(draft);

      db.cartItems = draft.cartItems;
      db.orders = draft.orders;
      db.products = draft.products;

      return result;
    },
    write(table, value) {
      if (table === 'cart_items') {
        db.cartItems.push(value as CartItem);
      }
      if (table === 'orders') {
        db.orders.push(value as ShopOrder);
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
  clone.orders = source.orders.map((item) => ({ ...item }));
  clone.products = new Map(
    [...source.products.entries()].map(([key, value]) => [key, { ...value }]),
  );

  return clone;
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
