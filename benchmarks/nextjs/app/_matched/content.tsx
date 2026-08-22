import catalog from '../../../shared/catalog.json';

export interface MatchedProduct {
  blurb: string;
  id: string;
  img: string;
  name: string;
  price: number;
  slug: string;
}

export const matchedCatalog = catalog as MatchedProduct[];

function price(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function MatchedListing({ basePath }: { basePath: string }) {
  return (
    <main data-benchmark-destination="listing">
      <section className="hero">
        <h1>Field goods for everyday carry</h1>
        <p>A 24-product capability-matched commerce benchmark.</p>
      </section>
      <section className="grid" aria-label="Products">
        {matchedCatalog.map((product) => {
          const href = `${basePath}/product/${product.slug}`;
          return (
            <article className="card" key={product.id}>
              <a href={href} aria-label={`View ${product.name}`}>
                <img src={product.img} width="640" height="480" loading="lazy" alt="" />
              </a>
              <h2>{product.name}</h2>
              <p>{product.blurb}</p>
              <span className="price">{price(product.price)}</span>
              <div className="card-actions">
                <a className="secondary-button" href={href}>
                  Details
                </a>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}

export function MatchedProductDetail({ product }: { product: MatchedProduct }) {
  return (
    <main className="detail" data-benchmark-destination="detail">
      <div className="detail-media">
        <img src={product.img} width="640" height="480" loading="eager" alt="" />
      </div>
      <section className="detail-copy">
        <h1>{product.name}</h1>
        <p>{product.blurb}</p>
        <span className="price">{price(product.price)}</span>
        <label className="qty-row">
          Qty
          <input type="number" min="1" defaultValue="1" />
        </label>
      </section>
    </main>
  );
}
