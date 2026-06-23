import { createFileRoute, Link, notFound } from '@tanstack/react-router';

import catalog from '../../../../shared/catalog.json';
import { AddToCartButton, CartButton, type Product } from '../../components/cart';

export const Route = createFileRoute('/product/$slug')({
  component: ProductRoute,
});

function price(value: number): string {
  return `$${value.toFixed(2)}`;
}

function ProductRoute() {
  const { slug } = Route.useParams();
  const product = (catalog as Product[]).find((item) => item.slug === slug);
  if (!product) throw notFound();

  return (
    <main className="detail">
      <div className="detail-media">
        <img src={product.img} width="640" height="480" loading="eager" alt="" />
      </div>
      <section className="detail-copy">
        <Link to="/">Back to listing</Link>
        <h1>{product.name}</h1>
        <p>{product.blurb}</p>
        <span className="price">{price(product.price)}</span>
        <label className="qty-row">
          Qty
          <input type="number" min="1" defaultValue="1" />
        </label>
        <div className="detail-actions">
          <AddToCartButton product={product} />
          <CartButton />
        </div>
      </section>
    </main>
  );
}
