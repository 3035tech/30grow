import ProductLandingClient from '../../../../app/_components/ProductLandingClient';
import {getProductLandingCopy} from '../../../../lib/product-landing-seo';
export default function BrandLandingPreview() {
 const locales=['pt-BR','pt-PT','en','es-419','es-ES','fr-FR','de-DE'];
 return <ProductLandingClient locale="pt-BR" copyByLocale={Object.fromEntries(locales.map(locale=>[locale,getProductLandingCopy(locale)]))} />;
}
