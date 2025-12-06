import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'BuJo Companion',
  description: 'Digitize your analog world.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  )
}

