/**
 * Resultado del estudio de estrategias (scripts/investigacion/estrategias.ts). ARCHIVO GENERADO: no editar a mano;
 * se vuelve a generar corriendo el script con los datos de datos-investigacion/. Es una medición del pasado, con
 * costos, separada en desarrollo y evaluación: no garantiza resultados futuros y no es asesoramiento financiero.
 */
import type { Medicion } from "./estrategias.ts";

export type FilaEstudio = {
  estrategia: string;
  agente: string;
  nombre: string;
  regla: string;
  marco: string;
  desarrollo: Medicion;
  evaluacion: Medicion;
  veredicto: string;
  monedasPositivas: number;
  monedasConOperaciones: number;
};

export const ESTUDIO_META = {
  "generado": "2026-10-14",
  "datosDesde": "2020-01-01",
  "datosHasta": "2026-09-30",
  "corte": "2024-09-21",
  "monedas": [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "BNBUSDT",
    "XRPUSDT",
    "ADAUSDT",
    "DOGEUSDT",
    "TRXUSDT",
    "BCHUSDT",
    "ZECUSDT"
  ],
  "costoPorLadoPct": 0.07,
  "horizonteVelas": 48
} as const;

export const ESTUDIO_FILAS: FilaEstudio[] = [
  {
    "estrategia": "RUPTURA",
    "agente": "Agente Ruptura",
    "nombre": "Ruptura de rango (Donchian 20)",
    "regla": "Cierre por encima del máximo de las 20 velas anteriores (o por debajo del mínimo). Stop en el extremo opuesto de 10 velas. Objetivo 2 R.",
    "marco": "1h",
    "desarrollo": {
      "operaciones": 9176,
      "ganadas": 3838,
      "winRate": 0.4183,
      "tasaTp1": 0.5398,
      "tasaTp2": 0.3173,
      "tasaTp3": 0.1955,
      "tasaSl": 0.4286,
      "profitFactor": 0.9983,
      "expectancia": -0.0008,
      "expectanciaIc": {
        "low": -0.0208,
        "high": 0.0191
      },
      "netoR": -7.7825,
      "maxCaidaR": 257.8551
    },
    "evaluacion": {
      "operaciones": 4070,
      "ganadas": 1733,
      "winRate": 0.4258,
      "tasaTp1": 0.5523,
      "tasaTp2": 0.326,
      "tasaTp3": 0.2088,
      "tasaSl": 0.4047,
      "profitFactor": 1.0603,
      "expectancia": 0.03,
      "expectanciaIc": {
        "low": -0.0003,
        "high": 0.0604
      },
      "netoR": 122.1388,
      "maxCaidaR": 77.1327
    },
    "veredicto": "SIN CONCLUSIÓN",
    "monedasPositivas": 6,
    "monedasConOperaciones": 10
  },
  {
    "estrategia": "CRUCE_EMA",
    "agente": "Agente Tendencia",
    "nombre": "Cruce de medias (EMA 20 / EMA 50)",
    "regla": "La EMA 20 cruza la EMA 50. Stop a 1,5 ATR. Objetivo 2 R.",
    "marco": "1h",
    "desarrollo": {
      "operaciones": 6676,
      "ganadas": 2414,
      "winRate": 0.3616,
      "tasaTp1": 0.6123,
      "tasaTp2": 0.4384,
      "tasaTp3": 0.3297,
      "tasaSl": 0.6234,
      "profitFactor": 0.9309,
      "expectancia": -0.0478,
      "expectanciaIc": {
        "low": -0.0761,
        "high": -0.0196
      },
      "netoR": -319.3523,
      "maxCaidaR": 458.6765
    },
    "evaluacion": {
      "operaciones": 3106,
      "ganadas": 1063,
      "winRate": 0.3422,
      "tasaTp1": 0.5963,
      "tasaTp2": 0.4214,
      "tasaTp3": 0.3168,
      "tasaSl": 0.6446,
      "profitFactor": 0.8335,
      "expectancia": -0.1213,
      "expectanciaIc": {
        "low": -0.1623,
        "high": -0.0803
      },
      "netoR": -376.7474,
      "maxCaidaR": 404.1622
    },
    "veredicto": "SIN VENTAJA",
    "monedasPositivas": 2,
    "monedasConOperaciones": 10
  },
  {
    "estrategia": "RSI",
    "agente": "Agente Reversión",
    "nombre": "Reversión por RSI 14 (30 / 70)",
    "regla": "El RSI sale de sobreventa (cruza 30 hacia arriba) o de sobrecompra (cruza 70 hacia abajo). Stop a 1,5 ATR. Objetivo 1,5 R.",
    "marco": "1h",
    "desarrollo": {
      "operaciones": 9794,
      "ganadas": 3762,
      "winRate": 0.3841,
      "tasaTp1": 0.6459,
      "tasaTp2": 0.4722,
      "tasaTp3": 0.3641,
      "tasaSl": 0.6078,
      "profitFactor": 0.7932,
      "expectancia": -0.1369,
      "expectanciaIc": {
        "low": -0.1568,
        "high": -0.1169
      },
      "netoR": -1340.561,
      "maxCaidaR": 1352.6711
    },
    "evaluacion": {
      "operaciones": 4368,
      "ganadas": 1688,
      "winRate": 0.3864,
      "tasaTp1": 0.6401,
      "tasaTp2": 0.4734,
      "tasaTp3": 0.3716,
      "tasaSl": 0.6062,
      "profitFactor": 0.7704,
      "expectancia": -0.1555,
      "expectanciaIc": {
        "low": -0.1855,
        "high": -0.1255
      },
      "netoR": -679.1493,
      "maxCaidaR": 707.0757
    },
    "veredicto": "SIN VENTAJA",
    "monedasPositivas": 0,
    "monedasConOperaciones": 10
  },
  {
    "estrategia": "BOLLINGER",
    "agente": "Agente Bandas",
    "nombre": "Vuelta a las bandas de Bollinger (20, 2)",
    "regla": "Cierra fuera de la banda y la vela siguiente vuelve adentro. Stop a 1,5 ATR. Objetivo 1,5 R.",
    "marco": "1h",
    "desarrollo": {
      "operaciones": 19950,
      "ganadas": 7866,
      "winRate": 0.3943,
      "tasaTp1": 0.6524,
      "tasaTp2": 0.4832,
      "tasaTp3": 0.3764,
      "tasaSl": 0.5972,
      "profitFactor": 0.8233,
      "expectancia": -0.1156,
      "expectanciaIc": {
        "low": -0.1297,
        "high": -0.1016
      },
      "netoR": -2306.7565,
      "maxCaidaR": 2315.0965
    },
    "evaluacion": {
      "operaciones": 8677,
      "ganadas": 3448,
      "winRate": 0.3974,
      "tasaTp1": 0.6584,
      "tasaTp2": 0.4901,
      "tasaTp3": 0.3838,
      "tasaSl": 0.5965,
      "profitFactor": 0.8003,
      "expectancia": -0.1337,
      "expectanciaIc": {
        "low": -0.1552,
        "high": -0.1123
      },
      "netoR": -1160.3896,
      "maxCaidaR": 1172.8613
    },
    "veredicto": "SIN VENTAJA",
    "monedasPositivas": 0,
    "monedasConOperaciones": 10
  },
  {
    "estrategia": "RETROCESO",
    "agente": "Agente Retroceso",
    "nombre": "Retroceso a la EMA 20 en tendencia (EMA 50 / 200)",
    "regla": "Con la EMA 50 por encima de la 200, el precio toca la EMA 20 y cierra arriba (al revés en baja). Stop a 1,5 ATR. Objetivo 2 R.",
    "marco": "1h",
    "desarrollo": {
      "operaciones": 14758,
      "ganadas": 5159,
      "winRate": 0.3496,
      "tasaTp1": 0.5888,
      "tasaTp2": 0.4181,
      "tasaTp3": 0.3185,
      "tasaSl": 0.635,
      "profitFactor": 0.8922,
      "expectancia": -0.0755,
      "expectanciaIc": {
        "low": -0.0943,
        "high": -0.0567
      },
      "netoR": -1114.7,
      "maxCaidaR": 1187.0661
    },
    "evaluacion": {
      "operaciones": 6518,
      "ganadas": 2226,
      "winRate": 0.3415,
      "tasaTp1": 0.5882,
      "tasaTp2": 0.4225,
      "tasaTp3": 0.32,
      "tasaSl": 0.6494,
      "profitFactor": 0.8386,
      "expectancia": -0.118,
      "expectanciaIc": {
        "low": -0.1464,
        "high": -0.0896
      },
      "netoR": -769.1322,
      "maxCaidaR": 779.6548
    },
    "veredicto": "SIN VENTAJA",
    "monedasPositivas": 1,
    "monedasConOperaciones": 10
  },
  {
    "estrategia": "MACD",
    "agente": "Agente Momento",
    "nombre": "Cruce de MACD (12, 26, 9) a favor de la EMA 200",
    "regla": "El MACD cruza su señal a favor de la tendencia de la EMA 200. Stop a 1,5 ATR. Objetivo 2 R.",
    "marco": "1h",
    "desarrollo": {
      "operaciones": 11484,
      "ganadas": 4044,
      "winRate": 0.3521,
      "tasaTp1": 0.595,
      "tasaTp2": 0.4254,
      "tasaTp3": 0.3286,
      "tasaSl": 0.6369,
      "profitFactor": 0.9077,
      "expectancia": -0.0649,
      "expectanciaIc": {
        "low": -0.0864,
        "high": -0.0434
      },
      "netoR": -745.1332,
      "maxCaidaR": 842.6501
    },
    "evaluacion": {
      "operaciones": 4998,
      "ganadas": 1742,
      "winRate": 0.3485,
      "tasaTp1": 0.5986,
      "tasaTp2": 0.4318,
      "tasaTp3": 0.3313,
      "tasaSl": 0.6407,
      "profitFactor": 0.8709,
      "expectancia": -0.0935,
      "expectanciaIc": {
        "low": -0.1262,
        "high": -0.0608
      },
      "netoR": -467.2872,
      "maxCaidaR": 479.5624
    },
    "veredicto": "SIN VENTAJA",
    "monedasPositivas": 1,
    "monedasConOperaciones": 10
  },
  {
    "estrategia": "SUPERTREND",
    "agente": "Agente Supertrend",
    "nombre": "Supertrend (10, 3) con filtro de EMA 200",
    "regla": "El Supertrend da vuelta a alcista con el cierre sobre la EMA 200 (o a bajista bajo la EMA 200). Stop en la línea del Supertrend. Objetivo 2 R.",
    "marco": "1h",
    "desarrollo": {
      "operaciones": 3811,
      "ganadas": 1678,
      "winRate": 0.4403,
      "tasaTp1": 0.5523,
      "tasaTp2": 0.3204,
      "tasaTp3": 0.1916,
      "tasaSl": 0.3991,
      "profitFactor": 1.0923,
      "expectancia": 0.0436,
      "expectanciaIc": {
        "low": 0.013,
        "high": 0.0742
      },
      "netoR": 166.2372,
      "maxCaidaR": 169.0412
    },
    "evaluacion": {
      "operaciones": 1783,
      "ganadas": 722,
      "winRate": 0.4049,
      "tasaTp1": 0.5345,
      "tasaTp2": 0.3034,
      "tasaTp3": 0.1896,
      "tasaSl": 0.4436,
      "profitFactor": 0.9413,
      "expectancia": -0.031,
      "expectanciaIc": {
        "low": -0.0764,
        "high": 0.0143
      },
      "netoR": -55.3401,
      "maxCaidaR": 95.512
    },
    "veredicto": "SIN CONCLUSIÓN",
    "monedasPositivas": 4,
    "monedasConOperaciones": 10
  },
  {
    "estrategia": "AZAR",
    "agente": "Agente Control (azar)",
    "nombre": "Entrada al azar (control)",
    "regla": "Entra en un 2 % de las velas, con lado al azar y semilla fija. Stop a 1,5 ATR. Objetivo 2 R. Sirve de vara: lo que no le gana a esto no tiene ventaja.",
    "marco": "1h",
    "desarrollo": {
      "operaciones": 6583,
      "ganadas": 2309,
      "winRate": 0.3508,
      "tasaTp1": 0.6216,
      "tasaTp2": 0.4364,
      "tasaTp3": 0.3078,
      "tasaSl": 0.6374,
      "profitFactor": 0.8748,
      "expectancia": -0.0881,
      "expectanciaIc": {
        "low": -0.1162,
        "high": -0.0601
      },
      "netoR": -580.2151,
      "maxCaidaR": 613.9102
    },
    "evaluacion": {
      "operaciones": 2895,
      "ganadas": 1103,
      "winRate": 0.381,
      "tasaTp1": 0.6363,
      "tasaTp2": 0.4598,
      "tasaTp3": 0.3482,
      "tasaSl": 0.6052,
      "profitFactor": 0.9859,
      "expectancia": -0.0097,
      "expectanciaIc": {
        "low": -0.0532,
        "high": 0.0338
      },
      "netoR": -28.0322,
      "maxCaidaR": 183.1318
    },
    "veredicto": "CONTROL",
    "monedasPositivas": 7,
    "monedasConOperaciones": 10
  },
  {
    "estrategia": "RUPTURA",
    "agente": "Agente Ruptura",
    "nombre": "Ruptura de rango (Donchian 20)",
    "regla": "Cierre por encima del máximo de las 20 velas anteriores (o por debajo del mínimo). Stop en el extremo opuesto de 10 velas. Objetivo 2 R.",
    "marco": "4h",
    "desarrollo": {
      "operaciones": 2307,
      "ganadas": 1019,
      "winRate": 0.4417,
      "tasaTp1": 0.5726,
      "tasaTp2": 0.3528,
      "tasaTp3": 0.2241,
      "tasaSl": 0.4161,
      "profitFactor": 1.2069,
      "expectancia": 0.0987,
      "expectanciaIc": {
        "low": 0.0574,
        "high": 0.1399
      },
      "netoR": 227.619,
      "maxCaidaR": 58.5877
    },
    "evaluacion": {
      "operaciones": 1026,
      "ganadas": 423,
      "winRate": 0.4123,
      "tasaTp1": 0.5799,
      "tasaTp2": 0.3304,
      "tasaTp3": 0.192,
      "tasaSl": 0.4347,
      "profitFactor": 1.0169,
      "expectancia": 0.0084,
      "expectanciaIc": {
        "low": -0.0512,
        "high": 0.068
      },
      "netoR": 8.6656,
      "maxCaidaR": 42.3343
    },
    "veredicto": "SIN CONCLUSIÓN",
    "monedasPositivas": 7,
    "monedasConOperaciones": 10
  },
  {
    "estrategia": "CRUCE_EMA",
    "agente": "Agente Tendencia",
    "nombre": "Cruce de medias (EMA 20 / EMA 50)",
    "regla": "La EMA 20 cruza la EMA 50. Stop a 1,5 ATR. Objetivo 2 R.",
    "marco": "4h",
    "desarrollo": {
      "operaciones": 1661,
      "ganadas": 621,
      "winRate": 0.3739,
      "tasaTp1": 0.6213,
      "tasaTp2": 0.4564,
      "tasaTp3": 0.345,
      "tasaSl": 0.6141,
      "profitFactor": 1.0682,
      "expectancia": 0.0441,
      "expectanciaIc": {
        "low": -0.013,
        "high": 0.1012
      },
      "netoR": 73.2185,
      "maxCaidaR": 72.547
    },
    "evaluacion": {
      "operaciones": 765,
      "ganadas": 279,
      "winRate": 0.3647,
      "tasaTp1": 0.5922,
      "tasaTp2": 0.4444,
      "tasaTp3": 0.3399,
      "tasaSl": 0.6327,
      "profitFactor": 1.0056,
      "expectancia": 0.0038,
      "expectanciaIc": {
        "low": -0.0805,
        "high": 0.088
      },
      "netoR": 2.8876,
      "maxCaidaR": 72.6632
    },
    "veredicto": "SIN CONCLUSIÓN",
    "monedasPositivas": 5,
    "monedasConOperaciones": 10
  },
  {
    "estrategia": "RSI",
    "agente": "Agente Reversión",
    "nombre": "Reversión por RSI 14 (30 / 70)",
    "regla": "El RSI sale de sobreventa (cruza 30 hacia arriba) o de sobrecompra (cruza 70 hacia abajo). Stop a 1,5 ATR. Objetivo 1,5 R.",
    "marco": "4h",
    "desarrollo": {
      "operaciones": 2648,
      "ganadas": 986,
      "winRate": 0.3724,
      "tasaTp1": 0.6503,
      "tasaTp2": 0.4721,
      "tasaTp3": 0.3527,
      "tasaSl": 0.6208,
      "profitFactor": 0.8099,
      "expectancia": -0.1232,
      "expectanciaIc": {
        "low": -0.1613,
        "high": -0.0851
      },
      "netoR": -326.2814,
      "maxCaidaR": 336.3339
    },
    "evaluacion": {
      "operaciones": 1182,
      "ganadas": 474,
      "winRate": 0.401,
      "tasaTp1": 0.6497,
      "tasaTp2": 0.4814,
      "tasaTp3": 0.3832,
      "tasaSl": 0.5897,
      "profitFactor": 0.9067,
      "expectancia": -0.0582,
      "expectanciaIc": {
        "low": -0.1161,
        "high": -0.0003
      },
      "netoR": -68.7674,
      "maxCaidaR": 96.2664
    },
    "veredicto": "SIN VENTAJA",
    "monedasPositivas": 3,
    "monedasConOperaciones": 10
  },
  {
    "estrategia": "BOLLINGER",
    "agente": "Agente Bandas",
    "nombre": "Vuelta a las bandas de Bollinger (20, 2)",
    "regla": "Cierra fuera de la banda y la vela siguiente vuelve adentro. Stop a 1,5 ATR. Objetivo 1,5 R.",
    "marco": "4h",
    "desarrollo": {
      "operaciones": 5021,
      "ganadas": 2031,
      "winRate": 0.4045,
      "tasaTp1": 0.6586,
      "tasaTp2": 0.4963,
      "tasaTp3": 0.3866,
      "tasaSl": 0.5907,
      "profitFactor": 0.9271,
      "expectancia": -0.045,
      "expectanciaIc": {
        "low": -0.0732,
        "high": -0.0169
      },
      "netoR": -226.155,
      "maxCaidaR": 229.1125
    },
    "evaluacion": {
      "operaciones": 2257,
      "ganadas": 915,
      "winRate": 0.4054,
      "tasaTp1": 0.6606,
      "tasaTp2": 0.4984,
      "tasaTp3": 0.3939,
      "tasaSl": 0.5897,
      "profitFactor": 0.9211,
      "expectancia": -0.0492,
      "expectanciaIc": {
        "low": -0.0914,
        "high": -0.007
      },
      "netoR": -111.046,
      "maxCaidaR": 159.2309
    },
    "veredicto": "SIN VENTAJA",
    "monedasPositivas": 3,
    "monedasConOperaciones": 10
  },
  {
    "estrategia": "RETROCESO",
    "agente": "Agente Retroceso",
    "nombre": "Retroceso a la EMA 20 en tendencia (EMA 50 / 200)",
    "regla": "Con la EMA 50 por encima de la 200, el precio toca la EMA 20 y cierra arriba (al revés en baja). Stop a 1,5 ATR. Objetivo 2 R.",
    "marco": "4h",
    "desarrollo": {
      "operaciones": 3478,
      "ganadas": 1275,
      "winRate": 0.3666,
      "tasaTp1": 0.607,
      "tasaTp2": 0.4339,
      "tasaTp3": 0.3278,
      "tasaSl": 0.6185,
      "profitFactor": 1.0238,
      "expectancia": 0.0155,
      "expectanciaIc": {
        "low": -0.0235,
        "high": 0.0544
      },
      "netoR": 53.8317,
      "maxCaidaR": 143.7324
    },
    "evaluacion": {
      "operaciones": 1624,
      "ganadas": 571,
      "winRate": 0.3516,
      "tasaTp1": 0.5979,
      "tasaTp2": 0.42,
      "tasaTp3": 0.3356,
      "tasaSl": 0.641,
      "profitFactor": 0.9749,
      "expectancia": -0.017,
      "expectanciaIc": {
        "low": -0.0747,
        "high": 0.0406
      },
      "netoR": -27.6749,
      "maxCaidaR": 95.3828
    },
    "veredicto": "SIN CONCLUSIÓN",
    "monedasPositivas": 6,
    "monedasConOperaciones": 10
  },
  {
    "estrategia": "MACD",
    "agente": "Agente Momento",
    "nombre": "Cruce de MACD (12, 26, 9) a favor de la EMA 200",
    "regla": "El MACD cruza su señal a favor de la tendencia de la EMA 200. Stop a 1,5 ATR. Objetivo 2 R.",
    "marco": "4h",
    "desarrollo": {
      "operaciones": 2767,
      "ganadas": 1024,
      "winRate": 0.3701,
      "tasaTp1": 0.6325,
      "tasaTp2": 0.4449,
      "tasaTp3": 0.3433,
      "tasaSl": 0.618,
      "profitFactor": 1.0621,
      "expectancia": 0.0403,
      "expectanciaIc": {
        "low": -0.0039,
        "high": 0.0846
      },
      "netoR": 111.638,
      "maxCaidaR": 84.3271
    },
    "evaluacion": {
      "operaciones": 1231,
      "ganadas": 445,
      "winRate": 0.3615,
      "tasaTp1": 0.6019,
      "tasaTp2": 0.433,
      "tasaTp3": 0.342,
      "tasaSl": 0.6353,
      "profitFactor": 1.001,
      "expectancia": 0.0007,
      "expectanciaIc": {
        "low": -0.0659,
        "high": 0.0672
      },
      "netoR": 0.8256,
      "maxCaidaR": 61.0854
    },
    "veredicto": "SIN CONCLUSIÓN",
    "monedasPositivas": 5,
    "monedasConOperaciones": 10
  },
  {
    "estrategia": "SUPERTREND",
    "agente": "Agente Supertrend",
    "nombre": "Supertrend (10, 3) con filtro de EMA 200",
    "regla": "El Supertrend da vuelta a alcista con el cierre sobre la EMA 200 (o a bajista bajo la EMA 200). Stop en la línea del Supertrend. Objetivo 2 R.",
    "marco": "4h",
    "desarrollo": {
      "operaciones": 938,
      "ganadas": 412,
      "winRate": 0.4392,
      "tasaTp1": 0.5288,
      "tasaTp2": 0.3028,
      "tasaTp3": 0.1919,
      "tasaSl": 0.4158,
      "profitFactor": 1.0716,
      "expectancia": 0.0347,
      "expectanciaIc": {
        "low": -0.0275,
        "high": 0.0968
      },
      "netoR": 32.5422,
      "maxCaidaR": 89.9162
    },
    "evaluacion": {
      "operaciones": 438,
      "ganadas": 213,
      "winRate": 0.4863,
      "tasaTp1": 0.5913,
      "tasaTp2": 0.3539,
      "tasaTp3": 0.2283,
      "tasaSl": 0.3995,
      "profitFactor": 1.3738,
      "expectancia": 0.1687,
      "expectanciaIc": {
        "low": 0.0739,
        "high": 0.2635
      },
      "netoR": 73.8814,
      "maxCaidaR": 21.4123
    },
    "veredicto": "VENTAJA",
    "monedasPositivas": 10,
    "monedasConOperaciones": 10
  },
  {
    "estrategia": "AZAR",
    "agente": "Agente Control (azar)",
    "nombre": "Entrada al azar (control)",
    "regla": "Entra en un 2 % de las velas, con lado al azar y semilla fija. Stop a 1,5 ATR. Objetivo 2 R. Sirve de vara: lo que no le gana a esto no tiene ventaja.",
    "marco": "4h",
    "desarrollo": {
      "operaciones": 1754,
      "ganadas": 599,
      "winRate": 0.3415,
      "tasaTp1": 0.5587,
      "tasaTp2": 0.3894,
      "tasaTp3": 0.2999,
      "tasaSl": 0.6465,
      "profitFactor": 0.9031,
      "expectancia": -0.0659,
      "expectanciaIc": {
        "low": -0.1197,
        "high": -0.0121
      },
      "netoR": -115.5498,
      "maxCaidaR": 217.0133
    },
    "evaluacion": {
      "operaciones": 766,
      "ganadas": 271,
      "winRate": 0.3538,
      "tasaTp1": 0.5822,
      "tasaTp2": 0.4386,
      "tasaTp3": 0.3264,
      "tasaSl": 0.6371,
      "profitFactor": 0.9699,
      "expectancia": -0.0203,
      "expectanciaIc": {
        "low": -0.1037,
        "high": 0.0631
      },
      "netoR": -15.5696,
      "maxCaidaR": 61.5509
    },
    "veredicto": "CONTROL",
    "monedasPositivas": 4,
    "monedasConOperaciones": 10
  }
];
