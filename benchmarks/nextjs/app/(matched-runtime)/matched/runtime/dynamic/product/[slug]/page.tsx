import { notFound } from 'next/navigation';

import { MatchedProductDetail, matchedCatalog } from '../../../../../../_matched/content';
import { MatchedL0Shell } from '../../../../../../_matched/l0-shell';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const contentBasePath = '/matched/l0';

export default async function MatchedDynamicProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = matchedCatalog.find((item) => item.slug === slug);
  if (!product) notFound();
  return (
    <MatchedL0Shell basePath={contentBasePath}>
      <MatchedProductDetail product={product} />
    </MatchedL0Shell>
  );
}
