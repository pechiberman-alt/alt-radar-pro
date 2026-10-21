import PuertaPro from "./puerta-pro";
import RadarApp from "./radar-app";

/** La terminal detrás de la puerta PRO: presentación para visitantes, pago para vencidos, la terminal para el resto. */
export default function Home() {
  return (
    <PuertaPro>
      <RadarApp />
    </PuertaPro>
  );
}
