import type { Metadata } from 'next'
import './globals.css'
export const metadata: Metadata = { title: 'Emotion Reset — Hopemo AI', description: 'Make a little space in your head.' }
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en">
<body>{children}</body></html> }
