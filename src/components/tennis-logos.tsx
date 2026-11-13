// Logos de los circuitos para las cabeceras de los torneos, en el color del texto (currentColor) para que se lean sobre el fondo
// oscuro. ATP (2025) y WTA (2025): logos de texto en dominio público en Wikimedia Commons (File:ATP_Tour_logo.svg y
// File:WTA_2025.svg); siguen siendo marcas registradas y sólo se usan para decir de qué circuito es cada torneo. El del
// ATP Challenger Tour (2023) es una imagen: public/tennis/atp-challenger.png
type P = { className?: string; title?: string };

const ATP = ["M976.8073,32.4589C954.8818,10.5335,921.578,0,867.1936,0h-99.0666l-18.4098,68.5699c42.7744-.695,86.7616-.3815,131.7708,1.1719,18.0963.9266,31.8457,7.5492,35.5113,20.5764,3.7337,13.2452-2.9161,27.9894-16.4884,37.6235-9.0891,6.4455-19.4863,10.1247-37.4872,10.1247-9.3207,0-106.7657-.8176-131.907-.2316l-42.243,157.28h98.6306l21.5167-80.0981h41.7387c93.5886,0,149.2403-49.3288,149.2403-123.0905,0-23.1927-7.5901-43.8373-23.1928-59.4399v-.0272Z","M415.3438,94.5016c-65.3131,8.653-134.0737,19.8269-202.0303,34.0533L301.5603,0h99.5708l14.2126,94.5016Z","M445.4998,295.1012h-104.967l-6.4046-51.6591h-93.9973l-33.6445,51.6591h-107.5015l35.2524-51.6591H0c130.8169-39.2587,287.075-66.1034,425.2776-82.9052l20.2358,134.5507h0l-.0136.0136Z","M520.8694,150.1669c36.2609-3.4612,70.2187-6.1457,100.8244-8.1215l-41.1119,153.0558h-98.6441l38.9316-144.9343Z","M745.8337,0l-18.4779,68.8015c-63.0783,1.3627-163.4939,7.4675-277.2501,21.285L474.3068,0h271.5405-.0136Z"];
const WTA = ["M445.65,0c-16.22,0-30.55,10.57-35.32,26.06l-48.96,158.94h48.4l13.26-43.06c14.17,8.19,25.76,22.03,30.83,43.06h46.14V0h-54.35ZM427.43,127.67l26.43-85.8v94.33c-8.87-4.7-18.2-7.38-26.43-8.53ZM215.95,0l-44.08,143.11V0h-54.34c-16.23,0-30.55,10.57-35.33,26.06l-36.06,117.05V0H0v185h54.34c16.23,0,30.55-10.57,35.33-26.06l36.06-117.05v143.11h54.34c16.23,0,30.55-10.57,35.33-26.06L264.36,0h-48.41,0ZM403.45,0h-124.11l-12.91,41.9h38.58l-44.09,143.1h46.78l44.09-143.1h38.76L403.45,0h0Z"];

export const AtpLogo = ({ className, title = 'ATP' }: P) => (
  <svg viewBox="0 0 1000 295.1148" role="img" aria-label={title} className={className} fill="currentColor">{ATP.map(d => <path key={d} d={d} />)}</svg>
);
export const WtaLogo = ({ className, title = 'WTA' }: P) => (
  <svg viewBox="0 0 500 185" role="img" aria-label={title} className={className} fill="currentColor">{WTA.map(d => <path key={d} d={d} />)}</svg>
);
export const ChallengerLogo = ({ className, title = 'ATP Challenger Tour' }: P) => (
  <img src="/tennis/atp-challenger.png" alt={title} width={660} height={151} loading="lazy" decoding="async" className={className} />
);
