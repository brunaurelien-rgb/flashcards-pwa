# Flashcards PWA

Cette version fonctionne comme une app web installable sur iPhone.

## Tester sur le PC

Depuis le dossier du projet :

    npm run pwa

Puis ouvre :

    http://localhost:4173

## Tester sur iPhone sur le même Wi-Fi

1. Lance npm run pwa sur le PC.
2. Ouvre Safari sur l iPhone.
3. Va sur http://ADRESSE-IP-DU-PC:4173.
4. Touche Partager, puis Sur l écran d accueil.

Cette méthode locale demande encore que le PC soit allumé.

## Utiliser sans PC allumé

Pour que l app fonctionne sans PC, héberge le contenu du dossier pwa sur un service HTTPS gratuit, par exemple Netlify, Vercel ou GitHub Pages. Ensuite ouvre l adresse HTTPS une fois dans Safari, ajoute l app à l écran d accueil, puis elle pourra fonctionner hors ligne grâce au service worker.

## Données locales

La progression est sauvegardée dans le stockage local du navigateur sur l iPhone.
