import Link from 'next/link';

import catalog from '../../shared/catalog.json';
import { AddToCartButton, type Product } from './components/cart';

function price(value: number): string {
  return `$${value.toFixed(2)}`;
}

export default function Page() {
  const products = catalog as Product[];

  return (
    <main>
      <section className="hero">
        <h1>Field goods for everyday carry</h1>
        <p>
          A 24-product commerce benchmark rendered with Next.js App Router and hydrated cart UI.
        </p>
      </section>
      <section className="grid" aria-label="Products">
        {products.map((product) => (
          <article className="card" key={product.id}>
            <Link href={`/product/${product.slug}`} aria-label={`View ${product.name}`}>
              <img src={product.img} width="640" height="480" loading="lazy" alt="" />
            </Link>
            <h2>{product.name}</h2>
            <p>{product.blurb}</p>
            <span className="price">{price(product.price)}</span>
            <div className="card-actions">
              <Link className="secondary-button" href={`/product/${product.slug}`}>
                Details
              </Link>
              <AddToCartButton product={product} />
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
