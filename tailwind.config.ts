import type { Config } from 'tailwindcss'
const config: Config = { content: ['./app/**/*.{js,ts,jsx,tsx}'], theme: { extend: { colors: { ink: '#352b35', blush: '#f8d9d4', peach: '#f6b8a1', lavender: '#d9cef2', cream: '#fffaf5' }, fontFamily: { serif: ['Georgia', 'serif'], sans: ['Arial', 'sans-serif'] } } }, plugins: [] }
export default config
