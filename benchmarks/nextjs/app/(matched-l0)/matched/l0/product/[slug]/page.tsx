import { notFound } from 'next/navigation';

import { MatchedProductDetail, matchedCatalog } from '../../../../../_matched/content';
import { MatchedL0Shell } from '../../../../../_matched/l0-shell';

const basePath = '/matched/l0';

export function generateStaticParams() {
  return matchedCatalog.map((product) => ({ slug: product.slug }));
}

export default async function MatchedL0ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = matchedCatalog.find((item) => item.slug === slug);
  if (!product) notFound();
  return (
    <MatchedL0Shell basePath={basePath}>
      <MatchedProductDetail product={product} />
    </MatchedL0Shell>
  );
}
