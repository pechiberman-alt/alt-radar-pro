import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./open-heatmap.css";
import PwaRegister from "./pwa-register";
const sans=Geist({variable:"--font-sans",subsets:["latin"]});
const mono=Geist_Mono({variable:"--font-mono",subsets:["latin"]});
export const metadata:Metadata={title:"ALT RADAR PRO — Inteligencia de Mercado Cripto",description:"Cerebro de inteligencia probabilística para régimen cripto, rotación de capital, confluencia técnica y riesgo geopolítico.",manifest:"/manifest.webmanifest",applicationName:"ALT RADAR PRO",appleWebApp:{capable:true,statusBarStyle:"black-translucent",title:"ALT RADAR"},formatDetection:{telephone:false},icons:{icon:[{url:"/icon-192.png",sizes:"192x192",type:"image/png"}],apple:[{url:"/icon-192.png",sizes:"192x192",type:"image/png"}]},openGraph:{title:"ALT RADAR PRO",description:"Inteligencia de Mercado Cripto",images:[{url:"/og.png",width:1792,height:933}]},twitter:{card:"summary_large_image",title:"ALT RADAR PRO",description:"Inteligencia de Mercado Cripto",images:["/og.png"]}};
export const viewport:Viewport={width:"device-width",initialScale:1,maximumScale:1,viewportFit:"cover",themeColor:"#050807"};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="es"><body className={`${sans.variable} ${mono.variable}`}><PwaRegister/>{children}</body></html>}
