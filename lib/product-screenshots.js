/** Real product captures from the isolated Eval 20 demonstration tenant. */
const image = (name, width = 1937, height = 1203) => ({ src: `/product/${name}.webp`, width, height });
export const OVERVIEW_SCREENSHOT = image('visao-geral');
export const SOLUTION_SCREENSHOTS = [
  image('recrutamento-pipeline', 2152, 1464), image('motivadores'), image('pdi'),
  image('onboarding-jornada'), null, image('organograma'),
];
export const HOME_SCREENSHOT_INDICES = [0, 2, 3, 5];
export function screenshotLabels(locale = 'pt-BR') {
  const language = locale.slice(0, 2);
  return ({
    pt: { title: 'Veja o 30Grow em uso', note: 'Tela real do 30Grow com dados demonstrativos.', enlarge: 'Ampliar imagem' },
    en: { title: 'See 30Grow in use', note: 'Real 30Grow screen with sample data. Interface shown in Portuguese.', enlarge: 'Enlarge image' },
    es: { title: 'Mira 30Grow en uso', note: 'Pantalla real de 30Grow con datos de ejemplo. Interfaz en portugués.', enlarge: 'Ampliar imagen' },
    fr: { title: 'Découvrez 30Grow en action', note: 'Écran réel de 30Grow avec des données de démonstration. Interface en portugais.', enlarge: 'Agrandir l’image' },
    de: { title: '30Grow im Einsatz', note: 'Echte 30Grow-Ansicht mit Beispieldaten. Oberfläche auf Portugiesisch.', enlarge: 'Bild vergrößern' },
  })[language] || { title: 'See 30Grow in use', note: 'Real 30Grow screen with sample data. Interface shown in Portuguese.', enlarge: 'Enlarge image' };
}
