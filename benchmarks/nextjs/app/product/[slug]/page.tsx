import Link from 'next/link';
import { notFound } from 'next/navigation';

import catalog from '../../../../shared/catalog.json';
import { AddToCartButton, CartButton, type Product } from '../../components/cart';

function price(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function generateStaticParams() {
  return (catalog as Product[]).map((product) => ({ slug: product.slug }));
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = (catalog as Product[]).find((item) => item.slug === slug);
  if (!product) notFound();

  return (
    <main className="detail">
      <div className="detail-media">
        <img src={product.img} width="640" height="480" loading="eager" alt="" />
      </div>
      <section className="detail-copy">
        <Link href="/">Back to listing</Link>
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
