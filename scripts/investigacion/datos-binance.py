#!/usr/bin/env python3
"""Baja de data.binance.vision lo que falta para el preregistro del flujo (scripts/investigacion/preregistro-flujo.ts):
velas de futuros USDⓈ-M de 4 h con volumen taker comprador, funding y, con --metricas, open interest a 5 min.

LICENCIA: los datos de Binance Vision están bajo CC BY-NC-SA 4.0 (términos v1.0 del 26/08/2026). Uso permitido:
investigación personal de backtesting, no producción. No se commitean (datos-investigacion/ está en .gitignore), no se
redistribuyen y no alimentan señales para terceros. Cada zip se verifica con su .CHECKSUM (sha256).

  python3 scripts/investigacion/datos-binance.py [carpeta] [--metricas] [--desde 2020-01 --hasta 2026-09]

Escribe en la carpeta (por defecto datos-investigacion):
  SIMBOLO-4h-fut.json   [openTime, open, high, low, close, volumen, volumenTakerComprador]
  SIMBOLO-funding.json  [fundingTime, tasa]
  SIMBOLO-oi.json       [hora, openInterest]  (solo con --metricas; un dato cada 5 min, días faltantes quedan sin dato)
Corre en tu PC: este entorno de Claude no tiene salida a data.binance.vision.
"""
import argparse
import csv
import hashlib
import io
import json
import sys
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

MONEDAS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "TRXUSDT", "DOGEUSDT", "ZECUSDT", "ADAUSDT", "BCHUSDT"]
BASE = "https://data.binance.vision/data/futures/um"


def meses(desde, hasta):
    y, m = map(int, desde.split("-"))
    ye, me = map(int, hasta.split("-"))
    while (y, m) <= (ye, me):
        yield f"{y}-{m:02d}"
        m += 1
        if m == 13:
            y, m = y + 1, 1


def bajar(url, destino: Path):
    """Baja un zip y su .CHECKSUM; devuelve las filas del CSV de adentro, o None si no existe o no verifica."""
    if not destino.exists():
        try:
            datos = urllib.request.urlopen(url, timeout=60).read()
            suma = urllib.request.urlopen(url + ".CHECKSUM", timeout=60).read().decode().split()[0]
        except urllib.error.HTTPError:
            return None
        if hashlib.sha256(datos).hexdigest() != suma:
            print(f"checksum distinto, se descarta: {url}", file=sys.stderr)
            return None
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(datos)
    with zipfile.ZipFile(io.BytesIO(destino.read_bytes())) as z:
        texto = z.read(z.namelist()[0]).decode()
    filas = list(csv.reader(io.StringIO(texto)))
    return [f for f in filas if f and f[0][:1].isdigit()]  # sin encabezado (algunos meses lo traen)


def ms(v):
    t = int(float(v))
    return t // 1000 if t > 10**14 else t  # microsegundos desde 2025 en algunos archivos


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("carpeta", nargs="?", default="datos-investigacion")
    ap.add_argument("--monedas", nargs="*", default=MONEDAS)
    ap.add_argument("--desde", default="2020-01")
    ap.add_argument("--hasta", default="2026-09")
    ap.add_argument("--metricas", action="store_true", help="también open interest diario a 5 min (muchos archivos)")
    a = ap.parse_args()
    out = Path(a.carpeta)
    crudo = out / "crudo-binance"
    for sym in a.monedas:
        ms_ = list(meses(a.desde, a.hasta))
        with ThreadPoolExecutor(8) as ex:
            k = ex.map(lambda m: bajar(f"{BASE}/monthly/klines/{sym}/4h/{sym}-4h-{m}.zip", crudo / sym / f"k-{m}.zip"), ms_)
            f = ex.map(lambda m: bajar(f"{BASE}/monthly/fundingRate/{sym}/{sym}-fundingRate-{m}.zip", crudo / sym / f"f-{m}.zip"), ms_)
            velas = {ms(r[0]): [ms(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5]), float(r[9])] for filas in k if filas for r in filas}
            funding = {ms(r[0]): [ms(r[0]), float(r[2])] for filas in f if filas for r in filas}
        if velas:
            (out / f"{sym}-4h-fut.json").write_text(json.dumps([velas[t] for t in sorted(velas)]))
        if funding:
            (out / f"{sym}-funding.json").write_text(json.dumps([funding[t] for t in sorted(funding)]))
        print(f"{sym}: {len(velas)} velas 4h de futuros, {len(funding)} fundings", file=sys.stderr)
        if a.metricas:
            d0 = date.fromisoformat(a.desde + "-01")
            d1 = date.fromisoformat(a.hasta + "-28")
            dias = [d0 + timedelta(days=i) for i in range((d1 - d0).days + 1)]
            with ThreadPoolExecutor(8) as ex:
                res = ex.map(lambda d: bajar(f"{BASE}/daily/metrics/{sym}/{sym}-metrics-{d}.zip", crudo / sym / f"m-{d}.zip"), dias)
                oi = {}
                for filas in res:
                    for r in filas or []:
                        # create_time "AAAA-MM-DD HH:MM:SS" en UTC; columna 2 = sum_open_interest
                        t = int(datetime.fromisoformat(r[0]).replace(tzinfo=timezone.utc).timestamp() * 1000)
                        oi[t] = [t, float(r[2])]
            (out / f"{sym}-oi.json").write_text(json.dumps([oi[t] for t in sorted(oi)]))
            print(f"{sym}: {len(oi)} lecturas de open interest", file=sys.stderr)


if __name__ == "__main__":
    main()
