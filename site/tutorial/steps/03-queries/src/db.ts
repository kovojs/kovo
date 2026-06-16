// Tutorial step 03 (chapter 3): an in-memory database standing in for the
// SPEC.md section 10.1 schema layer. The blessed @kovojs/drizzle path derives
// domains from real table annotations; the tutorial keeps the storage plain
// so every behavior stays visible.

// snippet:db
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

export interface ShopDb {
  cartItems: CartItem[];
  products: Map<string, ShopProduct>;
}

export function createShopDb(): ShopDb {
  return {
    cartItems: [],
    products: new Map([
      ['p1', { id: 'p1', name: 'Pour-over kettle', stock: 5, unitPrice: 1499 }],
      ['p2', { id: 'p2', name: 'Ceramic dripper', stock: 2, unitPrice: 2599 }],
      ['p3', { id: 'p3', name: 'Paper filters', stock: 8, unitPrice: 399 }],
    ]),
  };
}
// /snippet

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
