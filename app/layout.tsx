import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
const geist=Geist({variable:'--font-sans',subsets:['latin']}); const mono=Geist_Mono({variable:'--font-mono',subsets:['latin']});
export const metadata:Metadata={title:'ModelSeal — AI Endpoint Capability Auditor',description:'Consensus-backed capability and behavioral drift audits for public AI agent endpoints.'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body className={`${geist.variable} ${mono.variable}`}>{children}</body></html>}
