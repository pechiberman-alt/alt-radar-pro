#!/usr/bin/env python3
"""Baja las velas de Binance que usa la investigación y las deja en JSON.

Fuente: repositorio público Speirsy11/crypto-dataset (Parquet, un archivo por moneda, intervalo y mes), armado con
velas de Binance. Escribe SIMBOLO-INTERVALO.json con [openTime(ms), open, high, low, close, volume] por vela.

  pip install pyarrow
  python3 scripts/investigacion/datos.py [carpeta]        # por defecto: datos-investigacion
  python3 scripts/investigacion/datos.py datos --monedas BTCUSDT ETHUSDT --hasta 2026-09

Hace falta salida a github.com (media.githubusercontent.com). Los archivos ya bajados no se vuelven a bajar.
"""
import argparse
import io
import json
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pyarrow.parquet as pq

MONEDAS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "TRXUSDT", "DOGEUSDT", "ZECUSDT", "ADAUSDT", "BCHUSDT"]
INTERVALOS = {"15m": "2024-01", "1h": "2020-01", "4h": "2020-01", "1d": "2020-01"}
BASE = "https://media.githubusercontent.com/media/Speirsy11/crypto-dataset/main/data"


def meses(desde: str, hasta: str):
    y, m = map(int, desde.split("-"))
    ye, me = map(int, hasta.split("-"))
    while (y, m) <= (ye, me):
        yield y, m
        m += 1
        if m == 13:
            y, m = y + 1, 1


def bajar(url: str, destino: Path):
    if destino.exists() and destino.stat().st_size > 0:
        return True
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            datos = r.read()
    except urllib.error.HTTPError:
        return False  # ese mes no existe
    if not datos.startswith(b"PAR1"):
        return False  # no es un Parquet (por ejemplo, un puntero de Git LFS)
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(datos)
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("carpeta", nargs="?", default="datos-investigacion")
    ap.add_argument("--monedas", nargs="*", default=MONEDAS)
    ap.add_argument("--desde", default=None, help="AAAA-MM; por defecto 2020-01 (15m: 2024-01)")
    ap.add_argument("--hasta", default="2026-09")
    a = ap.parse_args()
    out = Path(a.carpeta)
    crudo = out / "crudo"
    trabajos = []
    for sym in a.monedas:
        for iv, ini in INTERVALOS.items():
            for y, m in meses(a.desde or ini, a.hasta):
                nombre = f"{sym}-{iv}-{y}-{m:02d}.parquet"
                url = f"{BASE}/interval_id={iv}/symbol_id={sym}/year={y}/month={m:02d}/{nombre}"
                trabajos.append((sym, iv, url, crudo / sym / iv / nombre))
    print(f"{len(trabajos)} archivos mensuales a revisar…", file=sys.stderr)
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(lambda t: bajar(t[2], t[3]), trabajos))
    for sym in a.monedas:
        for iv in INTERVALOS:
            velas = {}
            for f in sorted((crudo / sym / iv).glob("*.parquet")):
                for fila in pq.read_table(io.BytesIO(f.read_bytes())).to_pylist():
                    t = int(fila["timestamp"].timestamp() * 1000)
                    velas[t] = [t, fila["open"], fila["high"], fila["low"], fila["close"], fila["volume"]]
            if velas:
                (out / f"{sym}-{iv}.json").write_text(json.dumps([velas[t] for t in sorted(velas)]))
                print(f"{sym}-{iv}: {len(velas)} velas", file=sys.stderr)


if __name__ == "__main__":
    main()
