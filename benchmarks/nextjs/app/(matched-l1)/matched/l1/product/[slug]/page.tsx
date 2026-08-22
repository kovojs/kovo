import { notFound } from 'next/navigation';

import { MatchedProductDetail, matchedCatalog } from '../../../../../_matched/content';
import { MatchedL1Shell } from '../../../../../_matched/l1-shell';

const basePath = '/matched/l1';

export function generateStaticParams() {
  return matchedCatalog.map((product) => ({ slug: product.slug }));
}

export default async function MatchedL1ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = matchedCatalog.find((item) => item.slug === slug);
  if (!product) notFound();
  return (
    <MatchedL1Shell basePath={basePath}>
      <MatchedProductDetail product={product} />
    </MatchedL1Shell>
  );
}
