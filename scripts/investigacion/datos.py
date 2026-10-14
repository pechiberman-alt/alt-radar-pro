#!/usr/bin/env python3
"""Baja las velas de Binance que usa la investigación y las deja en JSON.

Fuente: repositorio público Speirsy11/crypto-dataset (Parquet, un archivo por moneda, intervalo y mes), armado con
velas de Binance. Escribe SIMBOLO-INTERVALO.json con [openTime(ms), open, high, low, close, volume] por vela.

  pip install pyarrow
  python3 scripts/investigacion/datos.py [carpeta]        # por defecto: datos-investigacion
  python3 scripts/investigacion/datos.py datos --monedas BTCUSDT ETHUSDT --hasta 2026-09
  python3 scripts/investigacion/datos.py --tres-minutos   # SIMBOLO-3m.json, armado desde las velas de 1 min

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

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

MONEDAS =["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "TRXUSDT", "DOGEUSDT", "ZECUSDT", "ADAUSDT", "BCHUSDT"]
INTERVALOS = {"15m": "2024-01", "1h": "2020-01", "4h": "2020-01", "1d": "2020-01"}
BASE = "https://media.githubusercontent.com/media/Speirsy11/crypto-dataset/main/data"
TRES_MIN_MS = 180_000


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


def tres_minutos(out: Path, monedas, desde: str, hasta: str):
    """Arma SIMBOLO-3m.json desde las velas de 1 min del mismo repositorio (3 min no se publica allí).

    Cada vela de 3 min junta las tres de 1 min de su bloque: apertura de la primera, máximo, mínimo, cierre de la última
    y volumen sumado. Un bloque con menos de tres velas de 1 min no se usa; se cuenta junto con los minutos sin dato.
    """
    crudo = out / "crudo"
    trabajos = []
    for sym in monedas:
        for y, m in meses(desde, hasta):
            nombre = f"{sym}-1m-{y}-{m:02d}.parquet"
            url = f"{BASE}/interval_id=1m/symbol_id={sym}/year={y}/month={m:02d}/{nombre}"
            trabajos.append((url, crudo / sym / "1m" / nombre))
    print(f"{len(trabajos)} archivos de 1 min a revisar…", file=sys.stderr)
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(lambda t: bajar(t[0], t[1]), trabajos))
    for sym in monedas:
        partes = {k: [] for k in ("t", "open", "high", "low", "close", "volume")}
        for f in sorted((crudo / sym / "1m").glob("*.parquet")):
            tbl = pq.read_table(io.BytesIO(f.read_bytes()))
            ts = tbl.column("timestamp")
            ticks = ts.cast(pa.int64()).to_numpy()
            unidad = ts.type.unit  # s, ms, us o ns: se pasa a milisegundos
            partes["t"].append(ticks * 1000 if unidad == "s" else ticks // {"ms": 1, "us": 1_000, "ns": 1_000_000}[unidad])
            for k in ("open", "high", "low", "close", "volume"):
                partes[k].append(tbl.column(k).to_numpy().astype("float64"))
        if not partes["t"]:
            continue
        t, o, h, lo, c, v = (np.concatenate(partes[k]) for k in ("t", "open", "high", "low", "close", "volume"))
        orden = np.argsort(t, kind="stable")
        t, o, h, lo, c, v = (x[orden] for x in (t, o, h, lo, c, v))
        t, primera = np.unique(t, return_index=True)  # sin minutos repetidos
        o, h, lo, c, v = (x[primera] for x in (o, h, lo, c, v))
        faltan = int((t[-1] - t[0]) // 60_000 + 1 - len(t))
        bloque = t // TRES_MIN_MS
        inicio = np.r_[0, np.flatnonzero(np.diff(bloque)) + 1]
        fin = np.r_[inicio[1:], len(t)]
        completo = (fin - inicio) == 3
        tt = bloque[inicio][completo] * TRES_MIN_MS
        oo = o[inicio][completo]
        hh = np.maximum.reduceat(h, inicio)[completo]
        ll = np.minimum.reduceat(lo, inicio)[completo]
        cc = c[fin - 1][completo]
        vv = np.add.reduceat(v, inicio)[completo]
        filas = [list(x) for x in zip(tt.tolist(), oo.tolist(), hh.tolist(), ll.tolist(), cc.tolist(), vv.tolist())]
        (out / f"{sym}-3m.json").write_text(json.dumps(filas))
        print(f"{sym}-3m: {len(filas)} velas · {int((~completo).sum())} bloques incompletos · {faltan} minutos sin dato", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("carpeta", nargs="?", default="datos-investigacion")
    ap.add_argument("--monedas", nargs="*", default=MONEDAS)
    ap.add_argument("--desde", default=None, help="AAAA-MM; por defecto 2020-01 (15m: 2024-01; 3m con --tres-minutos: 2024-01)")
    ap.add_argument("--hasta", default="2026-09")
    ap.add_argument("--tres-minutos", action="store_true", help="arma SIMBOLO-3m.json desde las velas de 1 min")
    a = ap.parse_args()
    out = Path(a.carpeta)
    if a.tres_minutos:
        tres_minutos(out, a.monedas, a.desde or "2024-01", a.hasta)
        return
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
