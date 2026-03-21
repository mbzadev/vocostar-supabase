// [VOCOSTAR] Route alias: le client openapi-fetch supprime /platform de la baseUrl
// data/fetchers.ts: baseUrl = API_URL.replace('/platform', '')
// Donc les appels à /platform/auth/{ref}/config deviennent /api/auth/{ref}/config
// Ce handler réexporte le handler principal qui contient la logique complète.

export { default } from 'pages/api/platform/auth/[ref]/config'
