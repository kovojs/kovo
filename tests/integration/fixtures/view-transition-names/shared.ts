export interface ProductRecord {
  id: string;
  imageAlt: string;
  imageSrc: string;
  name: string;
}

export const productRecord: ProductRecord = {
  id: 'sku-1',
  imageAlt: 'Trail pack',
  imageSrc: '/assets/trail-pack.png',
  name: 'Trail Pack',
};
