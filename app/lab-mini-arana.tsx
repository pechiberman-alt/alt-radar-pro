/**
 * La mini araña del piso de estrategias: la misma araña del laboratorio (app/ai-trading-lab.tsx) en chico, una por agente,
 * pintada con el color de su veredicto. Es un dibujo para SVG (va dentro de otro <svg>): no tiene datos ni estado propios.
 * Con `activa` mueve las patas, salvo que la persona pida menos movimiento.
 */

const PATAS = Array.from({ length: 8 }, (_, k) => {
  const lado = k < 4 ? -1 : 1;
  const i = k % 4;
  const y = -3.5 + i * 2.6;
  return `M ${lado * 2.6} ${y} Q ${lado * 8.5} ${y - 5} ${lado * 12} ${y + 2 + i * 1.3}`;
});

export default function MiniArana({ x = 0, y = 0, escala = 1, activa = false }: { x?: number; y?: number; escala?: number; activa?: boolean }) {
  return (
    <g className={`mini-arana${activa ? " mini-arana-activa" : ""}`} transform={`translate(${x} ${y}) scale(${escala})`} aria-hidden="true">
      {PATAS.map((d, k) => (
        <path key={k} d={d} className="mini-pata" style={{ animationDelay: `${k * 0.1}s` }} />
      ))}
      <ellipse className="mini-torso" cx="0" cy="1.6" rx="3.1" ry="4" />
      <circle className="mini-cabeza" cx="0" cy="-3.4" r="2.1" />
      <circle className="mini-ojo" cx="-0.8" cy="-3.7" r="0.45" />
      <circle className="mini-ojo" cx="0.8" cy="-3.7" r="0.45" />
    </g>
  );
}
